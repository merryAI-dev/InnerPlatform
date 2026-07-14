import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createIdempotencyService } from '../idempotency.mjs';
import { resolveEditLeaseDocumentId } from '../edit-lease.mjs';
import { loadRbacPolicy } from '../rbac-policy.mjs';
import {
  createProjectRegistrationDraftService,
  mountProjectRegistrationDraftRoutes,
} from './project-registration-drafts.mjs';

const VALID_PDF = Buffer.from('%PDF-1.4\n');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  let retryBeforeSecondAttempt = null;

  function snapshot(path) {
    const exists = documents.has(path);
    return {
      exists,
      data: () => (exists ? clone(documents.get(path)) : undefined),
    };
  }

  function doc(path) {
    return {
      path,
      get: async () => snapshot(path),
      set: async (value, options = {}) => {
        const next = options.merge && documents.has(path)
          ? { ...documents.get(path), ...clone(value) }
          : clone(value);
        documents.set(path, next);
      },
    };
  }

  async function runAttempt(callback, commit) {
    const writes = [];
    const tx = {
      get: async (ref) => snapshot(ref.path),
      set: (ref, value, options = {}) => writes.push({ type: 'set', ref, value: clone(value), options }),
      create: (ref, value) => writes.push({ type: 'create', ref, value: clone(value) }),
      update: (ref, value) => writes.push({ type: 'update', ref, value: clone(value) }),
    };
    const result = await callback(tx);
    if (!commit) return result;
    for (const write of writes) {
      const current = documents.get(write.ref.path);
      if (write.type === 'create' && current !== undefined) throw new Error('document already exists');
      if (write.type === 'update' && current === undefined) throw new Error('document does not exist');
      documents.set(
        write.ref.path,
        (write.type === 'update' || write.options?.merge) && current
          ? { ...current, ...write.value }
          : write.value,
      );
    }
    return result;
  }

  return {
    documents,
    doc,
    retryNextTransaction(beforeSecondAttempt) {
      retryBeforeSecondAttempt = beforeSecondAttempt || (() => undefined);
    },
    async runTransaction(callback) {
      if (retryBeforeSecondAttempt) {
        const beforeSecondAttempt = retryBeforeSecondAttempt;
        retryBeforeSecondAttempt = null;
        await runAttempt(callback, false);
        await beforeSecondAttempt();
      }
      return runAttempt(callback, true);
    },
  };
}

function createHarness({
  seed = {},
  storageService,
  nowMs = Date.parse('2026-07-10T00:00:00.000Z'),
  auditChainService: auditOverride,
} = {}) {
  const db = createDb({
    'orgs/tenant-a/members/actor-a': {
      uid: 'actor-a',
      role: 'pm',
      status: 'ACTIVE',
      projectIds: [],
    },
    'orgs/tenant-a/members/actor-b': {
      uid: 'actor-b',
      role: 'pm',
      status: 'ACTIVE',
      projectIds: [],
    },
    'orgs/tenant-a/members/actor-admin': {
      uid: 'actor-admin',
      role: 'admin',
      status: 'ACTIVE',
      projectIds: [],
    },
    ...seed,
  });
  let currentNowMs = nowMs;
  let draftSequence = 0;
  let leaseSequence = 0;
  let attachmentSequence = 0;
  const auditChainService = auditOverride || {
    appendManyInTransaction: vi.fn(async () => []),
  };
  const idempotencyService = createIdempotencyService(db, {
    now: () => new Date(currentNowMs),
  });
  const service = createProjectRegistrationDraftService({
    db,
    now: () => new Date(currentNowMs).toISOString(),
    createDraftId: () => `draft-${++draftSequence}`,
    createLeaseId: () => `lease-${++leaseSequence}`,
    createAttachmentId: () => `attachment-${++attachmentSequence}`,
    createProjectId: () => 'project-1',
    createProjectRequestId: () => 'project-request-1',
    createRegistrationOutboxEvent: (input) => ({
      id: 'outbox-1',
      ...input,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: input.createdAt,
      updatedAt: input.createdAt,
    }),
    auditChainService,
    idempotencyService,
    draftStorageService: storageService,
    rbacPolicy: loadRbacPolicy(),
  });
  const base = {
    tenantId: 'tenant-a',
    actorId: 'actor-a',
    actorRole: 'pm',
    actorDisplayName: 'Actor A',
    requestId: 'request-a',
    sessionId: 'session-a',
  };
  return {
    db,
    service,
    base,
    auditChainService,
    advance(ms) { currentNowMs += ms; },
  };
}

function validRegistrationPayload(overrides = {}) {
  return {
    name: 'Private project',
    officialContractName: 'Private project contract',
    type: 'D1',
    status: 'CONTRACT_PENDING',
    phase: 'CONFIRMED',
    description: 'Description',
    clientOrg: 'Client',
    department: 'AXR',
    groupwareName: '2026 Private project',
    currency: 'KRW',
    contractAmount: 100_000,
    salesVatAmount: 10_000,
    totalRevenueAmount: 40_000,
    supportAmount: 0,
    financialInputFlags: { contractAmount: true, salesVatAmount: true, totalRevenueAmount: true },
    contractStart: '2026-07-01',
    contractEnd: '2026-12-31',
    contractType: '계약서(날인)',
    settlementType: 'TYPE1',
    basis: '공급가액',
    accountType: 'OPERATING',
    fundInputMode: 'BANK_UPLOAD',
    paymentPlan: { contract: 50_000, interim: 0, final: 50_000 },
    paymentPlanDesc: '50/50',
    settlementGuide: 'Guide',
    finalPaymentNote: 'Final note',
    projectPurpose: 'Purpose',
    registeredById: 'actor-a',
    registeredByName: 'Actor A',
    registeredByEmail: 'actor-a@example.com',
    managerId: 'actor-a',
    managerName: 'Actor A',
    teamName: 'AXR',
    teamMembers: 'Actor A · 실무책임자 · 100% · 실제 참여',
    teamMembersDetailed: [{
      memberName: 'Actor A',
      role: '실무책임자',
      participationRate: 100,
      isDocumentOnly: false,
    }],
    participantCondition: 'Condition',
    note: 'Note',
    arbitraryBrowserField: 'must-not-persist',
    ...overrides,
  };
}

function validRegistrationV2Payload(overrides = {}) {
  return validRegistrationPayload({
    registrationRequirementsVersion: 2,
    contractStart: '2026-01-01',
    contractEnd: '2027-12-31',
    contractAmount: 300_000,
    salesVatAmount: 30_000,
    totalRevenueAmount: 120_000,
    supportAmount: 10_000,
    financialInputFlags: {
      contractAmount: true,
      salesVatAmount: true,
      totalRevenueAmount: true,
      supportAmount: true,
    },
    financialYears: [
      { year: 2026, contractAmount: 100_000, salesVatAmount: 10_000, totalRevenueAmount: 40_000, supportAmount: 0, profitRate: 0.4, confirmed: true },
      { year: 2027, contractAmount: 200_000, salesVatAmount: 20_000, totalRevenueAmount: 80_000, supportAmount: 10_000, profitRate: 0.4, confirmed: true },
    ],
    registrationConfirmations: {
      laborIncludesFourInsurance: true,
      laborIncludesRetirementPay: true,
      customerSettlementBasisConfirmed: true,
      modusignContractUsed: true,
      originalContractSubmitted: false,
    },
    registrationOptionalDocumentNotes: {
      proposalWordOriginal: '해당 없음',
      proposalPptOriginal: '해당 없음',
      presentationPptOriginal: '해당 없음',
    },
    paymentExpectedMonths: {
      contract: '2026-07',
      interim: '',
      final: '2027-12',
    },
    advanceInterimBelow70Reason: '발주처 지급 조건에 따라 잔금 비중이 30%를 초과합니다.',
    ...overrides,
  });
}

function addRequiredRegistrationAttachments(db, draftId, existing = []) {
  const path = `orgs/tenant-a/projectRequestDrafts/${draftId}`;
  const draft = db.documents.get(path);
  const existingKinds = new Set(existing.map((attachment) => attachment.documentKind));
  const missing = ['contract', 'customer_business_registration', 'quote', 'rfp_request_evidence']
    .filter((documentKind) => !existingKinds.has(documentKind))
    .map((documentKind) => ({
      attachmentId: `required-${documentKind}`,
      documentKind,
      path: `orgs/tenant-a/project-registration-drafts/${draftId}/${documentKind}.pdf`,
      name: `${documentKind}.pdf`,
      size: VALID_PDF.byteLength,
      contentType: 'application/pdf',
    }));
  db.documents.set(path, { ...draft, attachmentRefs: [...existing, ...missing] });
}

async function expectHttpError(promise, statusCode, code) {
  await expect(promise).rejects.toMatchObject({ statusCode, code });
}

describe('project registration draft service', () => {
  it('creates one opaque draft and initial lease atomically, then replays exactly', async () => {
    const { db, service, base, auditChainService, advance } = createHarness();
    const input = {
      ...base,
      idempotencyKey: 'idem-create',
      payload: { name: 'Private draft' },
      stepIndex: 1,
    };

    const first = await service.create(input);
    const leasePath = `orgs/tenant-a/editLeases/${resolveEditLeaseDocumentId('project-registration', 'draft-1')}`;
    const storedExpiry = db.documents.get(leasePath).expiresAt;
    advance(60_000);
    const replay = await service.create(input);

    expect(first).toMatchObject({
      status: 201,
      replayed: false,
      body: {
        draft: { draftId: 'draft-1', draftRevision: 0, payload: { name: 'Private draft' } },
        lease: { state: 'ACTIVE', canEdit: true, leaseId: 'lease-1', fence: 1 },
      },
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(db.documents.get(leasePath).expiresAt).toBe(storedExpiry);
    expect([...db.documents.keys()].filter((path) => path.includes('/projectRequestDrafts/'))).toHaveLength(1);
    expect([...db.documents.keys()].filter((path) => path.includes('/editLeases/'))).toHaveLength(1);
    expect(auditChainService.appendManyInTransaction).toHaveBeenCalledTimes(1);
    expect(auditChainService.appendManyInTransaction.mock.calls[0][1].map((entry) => entry.action))
      .toEqual(['PROJECT_REGISTRATION_DRAFT_CREATE', 'EDIT_LEASE_ACQUIRE']);
    await expectHttpError(service.create({ ...input, sessionId: 'session-b' }), 409, 'idempotency_conflict');
  });

  it('rejects oversized create and PATCH payloads before fingerprinting or transactions', async () => {
    const harness = createHarness();
    const transactionSpy = vi.spyOn(harness.db, 'runTransaction');
    const oversizedPayload = { text: 'x'.repeat((900 * 1024) + 1) };

    await expectHttpError(
      harness.service.create({
        ...harness.base,
        idempotencyKey: 'idem-oversized-create',
        payload: oversizedPayload,
      }),
      413,
      'draft_payload_too_large',
    );
    expect(transactionSpy).not.toHaveBeenCalled();

    const created = await harness.service.create({
      ...harness.base,
      idempotencyKey: 'idem-small-create',
      payload: { name: 'small' },
    });
    transactionSpy.mockClear();
    await expectHttpError(
      harness.service.update({
        ...harness.base,
        idempotencyKey: 'idem-oversized-patch',
        draftId: created.body.draft.draftId,
        leaseId: created.body.lease.leaseId,
        fence: created.body.lease.fence,
        expectedDraftRevision: 0,
        payload: oversizedPayload,
      }),
      413,
      'draft_payload_too_large',
    );
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('rejects a nested own __proto__ key before create fingerprinting without writes', async () => {
    const { db, service, base, auditChainService } = createHarness();
    const dangerousPayload = JSON.parse(
      '{"profile":{"__proto__":{"displayName":"different"}}}',
    );

    await expectHttpError(
      service.create({ ...base, idempotencyKey: 'idem-create-dangerous-key', payload: dangerousPayload }),
      422,
      'draft_payload_invalid',
    );
    expect([...db.documents.keys()].filter((path) => path.includes('/projectRequestDrafts/'))).toHaveLength(0);
    expect([...db.documents.keys()].filter((path) => path.includes('/idempotency_keys/'))).toHaveLength(0);
    expect(auditChainService.appendManyInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a reused create key when two safe payloads differ', async () => {
    const { service, base } = createHarness();
    const idempotencyKey = 'idem-create-safe-conflict';

    await service.create({ ...base, idempotencyKey, payload: { profile: { name: 'first' } } });

    await expectHttpError(
      service.create({ ...base, idempotencyKey, payload: { profile: { name: 'second' } } }),
      409,
      'idempotency_conflict',
    );
  });

  it.each([
    ['undefined', () => ({ nested: { value: undefined } })],
    ['NaN', () => ({ value: Number.NaN })],
    ['infinite number', () => ({ value: Number.POSITIVE_INFINITY })],
    ['unsafe number', () => ({ value: Number.MAX_SAFE_INTEGER + 1 })],
    ['root undefined', () => undefined],
    ['root null', () => null],
    ['root array', () => []],
    ['root scalar', () => 'text'],
    ['nested array', () => ({ rows: [[1]] })],
    ['non-plain object', () => ({ createdAt: new Date() })],
    ['BigInt', () => ({ value: 1n })],
    ['oversized UTF-8 key', () => ({ ['가'.repeat(501)]: true })],
    ['cycle', () => {
      const value = {};
      value.self = value;
      return value;
    }],
    ['depth above 20', () => {
      let value = 'leaf';
      for (let depth = 0; depth < 10_000; depth += 1) value = { child: value };
      return value;
    }],
  ])('rejects %s before create fingerprinting without writes', async (_label, createPayload) => {
    const { db, service, base, auditChainService } = createHarness();

    await expectHttpError(
      service.create({
        ...base,
        idempotencyKey: `idem-invalid-${_label}`,
        payload: createPayload(),
      }),
      422,
      'draft_payload_invalid',
    );

    expect([...db.documents.keys()].filter((path) => path.includes('/projectRequestDrafts/'))).toHaveLength(0);
    expect([...db.documents.keys()].filter((path) => path.includes('/idempotency_keys/'))).toHaveLength(0);
    expect(auditChainService.appendManyInTransaction).not.toHaveBeenCalled();
  });

  it('adopts only the current owner legacy draft without deleting its data', async () => {
    const legacyPath = 'orgs/tenant-a/projectRequestDrafts/registration-actor-a';
    const legacy = {
      id: 'registration-actor-a',
      ownerId: 'actor-a',
      payloadSnapshot: { name: 'Legacy', contractDocument: { path: 'legacy.pdf' } },
      stepIndex: 3,
      attachmentRefs: [{ attachmentId: 'legacy-file', path: 'legacy.pdf' }],
      status: 'DRAFT',
      version: 4,
    };
    const { db, service, base } = createHarness({ seed: { [legacyPath]: legacy } });

    const created = await service.create({ ...base, idempotencyKey: 'idem-adopt' });

    expect(created.body.draft).toMatchObject({
      payload: legacy.payloadSnapshot,
      stepIndex: 3,
      attachmentRefs: legacy.attachmentRefs,
    });
    expect(db.documents.get(legacyPath)).toMatchObject({
      ...legacy,
      migrationStatus: 'ADOPTED',
      adoptedByDraftId: 'draft-1',
    });
  });

  it('ignores a legacy document whose owner does not match the actor', async () => {
    const legacyPath = 'orgs/tenant-a/projectRequestDrafts/registration-actor-a';
    const legacy = {
      ownerUid: 'actor-b',
      payloadSnapshot: { name: 'Foreign private draft' },
      status: 'DRAFT',
    };
    const { db, service, base } = createHarness({ seed: { [legacyPath]: legacy } });

    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-ignore-foreign',
      payload: { name: 'Actor A draft' },
    });

    expect(created.body.draft.payload).toEqual({ name: 'Actor A draft' });
    expect(db.documents.get(legacyPath)).toEqual(legacy);
  });

  it('returns an owner draft after lease expiry and hides it from every other actor', async () => {
    const { service, base, advance } = createHarness();
    const created = await service.create({ ...base, idempotencyKey: 'idem-private-read' });
    advance(1_800_000);

    await expect(service.get({ ...base, draftId: created.body.draft.draftId }))
      .resolves.toEqual({ draft: created.body.draft });
    await expectHttpError(
      service.get({ ...base, actorId: 'actor-b', actorRole: 'pm', draftId: created.body.draft.draftId }),
      404,
      'not_found',
    );
    await expectHttpError(
      service.get({ ...base, actorId: 'actor-admin', actorRole: 'admin', draftId: created.body.draft.draftId }),
      404,
      'not_found',
    );
  });

  it('revision-saves only the draft, replays exactly, and rejects stale or wrong-session writes', async () => {
    const { db, service, base } = createHarness();
    const created = await service.create({ ...base, idempotencyKey: 'idem-patch-create' });
    const ownership = {
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
    };
    const patch = {
      ...base,
      ...ownership,
      draftId: created.body.draft.draftId,
      idempotencyKey: 'idem-patch',
      expectedDraftRevision: 0,
      payload: { name: 'Saved privately' },
      stepIndex: 2,
    };

    const first = await service.update(patch);
    const replay = await service.update(patch);

    expect(first.body.draft).toMatchObject({ draftRevision: 1, payload: patch.payload, stepIndex: 2 });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(db.documents.get('orgs/tenant-a/projectRequestDrafts/draft-1')).toMatchObject({
      draftRevision: 1,
      payload: patch.payload,
    });
    await expectHttpError(
      service.update({ ...patch, idempotencyKey: 'idem-stale', expectedDraftRevision: 0 }),
      409,
      'draft_version_conflict',
    );
    await expectHttpError(
      service.update({ ...patch, idempotencyKey: 'idem-wrong-session', sessionId: 'session-b', expectedDraftRevision: 1 }),
      423,
      'edit_lease_held',
    );
    await expectHttpError(
      service.update({ ...patch, idempotencyKey: 'idem-wrong-fence', fence: ownership.fence + 1, expectedDraftRevision: 1 }),
      423,
      'edit_lease_held',
    );
  });

  it('atomically submits only the stored private draft and replays after releasing the lease', async () => {
    const memberPath = 'orgs/tenant-a/members/actor-a';
    const { db, service, base, auditChainService } = createHarness({
      seed: {
        [memberPath]: {
          uid: 'actor-a',
          role: 'pm',
          status: 'ACTIVE',
          name: 'Preserved Name',
          email: 'preserved@example.com',
          createdAt: '2025-01-01T00:00:00.000Z',
          projectId: 'existing-project',
          projectIds: ['existing-project'],
          projectNames: { 'existing-project': 'Existing' },
          portalProfile: {
            projectId: 'existing-project',
            projectIds: ['existing-project'],
            projectNames: { 'existing-project': 'Existing' },
            role: 'preserved-profile-role',
          },
        },
      },
    });
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-create',
      payload: validRegistrationV2Payload(),
    });
    addRequiredRegistrationAttachments(db, created.body.draft.draftId);
    const input = {
      ...base,
      actorEmail: 'actor-a@example.com',
      idempotencyKey: 'idem-submit',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    };

    const first = await service.submit(input);
    const replay = await service.submit(input);

    expect(first).toMatchObject({
      status: 201,
      replayed: false,
      body: {
        status: 'SUBMITTED',
        projectId: 'project-1',
        projectRequestId: 'project-request-1',
        projectVersion: 1,
        draftId: created.body.draft.draftId,
        draftRevision: 1,
        lease: { state: 'RELEASED', canEdit: false },
        outbox: { id: 'outbox-1', status: 'PENDING' },
      },
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(db.documents.get('orgs/tenant-a/projects/project-1')).toMatchObject({
      id: 'project-1',
      name: 'Private project',
      registrationSource: 'pm_portal',
      executiveReviewStatus: 'PENDING',
      version: 1,
      taxInvoiceAmount: 0,
      isSettled: false,
    });
    expect(db.documents.get('orgs/tenant-a/projects/project-1')).not.toHaveProperty('arbitraryBrowserField');
    expect(db.documents.get('orgs/tenant-a/project_requests/project-request-1')).toMatchObject({
      id: 'project-request-1',
      sourceDraftId: created.body.draft.draftId,
      status: 'PENDING',
      approvedProjectId: 'project-1',
      payload: { name: 'Private project' },
    });
    expect(db.documents.get('orgs/tenant-a/project_requests/project-request-1').payload)
      .not.toHaveProperty('arbitraryBrowserField');
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`)).toMatchObject({
      status: 'SUBMITTED',
      draftRevision: 1,
      submittedProjectId: 'project-1',
      submittedProjectRequestId: 'project-request-1',
    });
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .not.toHaveProperty('payload');
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .not.toHaveProperty('attachmentRefs');
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .not.toHaveProperty('stepIndex');
    expect(db.documents.get(`orgs/tenant-a/editLeases/${resolveEditLeaseDocumentId('project-registration', created.body.draft.draftId)}`))
      .toMatchObject({ state: 'RELEASED', releaseReason: 'FINAL_SUBMIT' });
    expect(db.documents.get(memberPath)).toMatchObject({
      uid: 'actor-a',
      role: 'pm',
      name: 'Preserved Name',
      email: 'preserved@example.com',
      createdAt: '2025-01-01T00:00:00.000Z',
      projectId: 'project-1',
      projectIds: ['existing-project', 'project-1'],
      projectNames: { 'existing-project': 'Existing', 'project-1': 'Private project' },
      lastLoginAt: '2026-07-10T00:00:00.000Z',
      portalProfile: {
        role: 'preserved-profile-role',
        projectId: 'project-1',
        projectIds: ['existing-project', 'project-1'],
        projectNames: { 'existing-project': 'Existing', 'project-1': 'Private project' },
      },
    });
    expect([...db.documents.keys()].filter((path) => path === 'outbox/outbox-1')).toHaveLength(1);
    const submitIdempotency = [...db.documents.values()]
      .find((document) => document.idempotencyKey === 'idem-submit');
    expect(Date.parse(submitIdempotency.expiresAt) - Date.parse(submitIdempotency.completedAt)).toBe(86_400_000);
    expect(auditChainService.appendManyInTransaction).toHaveBeenCalledTimes(2);
    expect(auditChainService.appendManyInTransaction.mock.calls[1][1].map((entry) => entry.action))
      .toEqual(['PROJECT_REGISTRATION_SUBMIT', 'EDIT_LEASE_RELEASE']);
  });

  it('passes all four required private attachment kinds into registration v2 final-submit validation', async () => {
    const storageService = {
      uploadDraftAttachment: vi.fn(async ({ tenantId, draftId, attachmentId, fileName, buffer, mimeType }) => ({
        path: `orgs/${tenantId}/project-registration-drafts/${draftId}/${attachmentId}-${fileName}`,
        name: fileName,
        size: buffer.byteLength,
        contentType: mimeType,
        uploadedAt: '2026-07-10T00:00:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const { db, service, base } = createHarness({ storageService });
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-v2-create',
      payload: validRegistrationV2Payload(),
    });
    const kinds = ['contract', 'customer_business_registration', 'quote', 'rfp_request_evidence'];
    for (const [revision, documentKind] of kinds.entries()) {
      await service.addAttachment({
        ...base,
        idempotencyKey: `idem-v2-${documentKind}`,
        draftId: created.body.draft.draftId,
        leaseId: created.body.lease.leaseId,
        fence: created.body.lease.fence,
        expectedDraftRevision: revision,
        documentKind,
        fileName: `${documentKind}.pdf`,
        mimeType: 'application/pdf',
        fileSize: VALID_PDF.byteLength,
        buffer: VALID_PDF,
      });
    }

    await service.submit({
      ...base,
      idempotencyKey: 'idem-v2-submit',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 4,
    });

    expect(db.documents.get('orgs/tenant-a/project_requests/project-request-1').payload).toMatchObject({
      registrationRequirementsVersion: 2,
      financialYears: [{ year: 2026, confirmed: true }, { year: 2027, confirmed: true }],
    });
    expect(db.documents.get('outbox/outbox-1').payload.attachmentRefs.map((item) => item.documentKind)).toEqual(kinds);
  });

  it('samples lease time again when Firestore retries final submit', async () => {
    const { db, service, base, advance } = createHarness();
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-retry-expiry-create',
      payload: validRegistrationV2Payload(),
    });
    addRequiredRegistrationAttachments(db, created.body.draft.draftId);
    db.retryNextTransaction(() => advance((30 * 60 * 1000) + 1));

    await expectHttpError(service.submit({
      ...base,
      idempotencyKey: 'idem-submit-retry-expiry',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    }), 410, 'edit_lease_expired');

    expect(db.documents.has('orgs/tenant-a/projects/project-1')).toBe(false);
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .toMatchObject({ status: 'ACTIVE', draftRevision: 0 });
  });

  it('uses the successful transaction attempt time for every final-submit record', async () => {
    const { db, service, base, advance, auditChainService } = createHarness();
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-retry-time-create',
      payload: validRegistrationV2Payload(),
    });
    addRequiredRegistrationAttachments(db, created.body.draft.draftId);
    db.retryNextTransaction(() => advance(60_000));

    const submitted = await service.submit({
      ...base,
      idempotencyKey: 'idem-submit-retry-time',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    });

    const successfulAt = '2026-07-10T00:01:00.000Z';
    expect(submitted.body.submittedAt).toBe(successfulAt);
    expect(db.documents.get('orgs/tenant-a/projects/project-1').createdAt).toBe(successfulAt);
    expect(db.documents.get('orgs/tenant-a/project_requests/project-request-1').requestedAt).toBe(successfulAt);
    expect(db.documents.get('outbox/outbox-1')).toMatchObject({
      createdAt: successfulAt,
      updatedAt: successfulAt,
      nextAttemptAt: successfulAt,
    });
    expect([...db.documents.values()].find((document) => document.idempotencyKey === 'idem-submit-retry-time'))
      .toMatchObject({ completedAt: successfulAt });
    expect(auditChainService.appendManyInTransaction.mock.calls.at(-1)[1]
      .every((entry) => entry.timestamp === successfulAt)).toBe(true);
  });

  it.each([
    ['boolean contract amount', { contractAmount: true }],
    ['non-numeric sales VAT', { salesVatAmount: 'not-money' }],
    ['negative revenue', { totalRevenueAmount: -1 }],
    ['negative payment amount', { paymentPlan: { contract: -1, interim: 0, final: 100_000 } }],
    ['invalid contract date', { contractStart: '2026-13-01' }],
    ['reversed contract dates', { contractStart: '2026-12-31', contractEnd: '2026-07-01' }],
  ])('rejects %s instead of coercing finance data during final submit', async (_label, payloadOverrides) => {
    const { db, service, base } = createHarness();
    const created = await service.create({
      ...base,
      idempotencyKey: `idem-submit-invalid-create-${_label}`,
      payload: validRegistrationPayload(payloadOverrides),
    });

    await expectHttpError(service.submit({
      ...base,
      idempotencyKey: `idem-submit-invalid-${_label}`,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    }), 422, 'project_registration_invalid');

    expect([...db.documents.keys()].filter((path) => path.includes('/projects/'))).toHaveLength(0);
    expect([...db.documents.keys()].filter((path) => path.startsWith('outbox/'))).toHaveLength(0);
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .toMatchObject({ status: 'ACTIVE', draftRevision: 0 });
  });

  it('rolls back every final-submit write when audit append fails', async () => {
    const auditChainService = { appendManyInTransaction: vi.fn(async () => []) };
    const { db, service, base } = createHarness({ auditChainService });
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-audit-create',
      payload: validRegistrationV2Payload(),
    });
    addRequiredRegistrationAttachments(db, created.body.draft.draftId);
    auditChainService.appendManyInTransaction.mockRejectedValueOnce(new Error('audit append failed'));

    await expect(service.submit({
      ...base,
      idempotencyKey: 'idem-submit-audit-failure',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    })).rejects.toThrow('audit append failed');

    expect([...db.documents.keys()].filter((path) => path.includes('/projects/'))).toHaveLength(0);
    expect([...db.documents.keys()].filter((path) => path.includes('/project_requests/'))).toHaveLength(0);
    expect([...db.documents.keys()].filter((path) => path.startsWith('outbox/'))).toHaveLength(0);
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .toMatchObject({ status: 'ACTIVE', draftRevision: 0 });
    expect(db.documents.get(`orgs/tenant-a/editLeases/${resolveEditLeaseDocumentId('project-registration', created.body.draft.draftId)}`))
      .toMatchObject({ state: 'ACTIVE' });
  });

  it('does not partially submit when a generated canonical ID collides', async () => {
    const existingProject = { id: 'project-1', name: 'Existing', version: 9 };
    const { db, service, base } = createHarness({
      seed: { 'orgs/tenant-a/projects/project-1': existingProject },
    });
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-collision-create',
      payload: validRegistrationV2Payload(),
    });
    addRequiredRegistrationAttachments(db, created.body.draft.draftId);

    await expectHttpError(service.submit({
      ...base,
      idempotencyKey: 'idem-submit-collision',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    }), 409, 'canonical_id_conflict');

    expect(db.documents.get('orgs/tenant-a/projects/project-1')).toEqual(existingProject);
    expect([...db.documents.keys()].filter((path) => path.includes('/project_requests/'))).toHaveLength(0);
    expect([...db.documents.keys()].filter((path) => path.startsWith('outbox/'))).toHaveLength(0);
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .toMatchObject({ status: 'ACTIVE', draftRevision: 0 });
  });

  it('maps only the latest typed private attachment to each canonical document field', async () => {
    const storageService = {
      uploadDraftAttachment: vi.fn(async ({ tenantId, draftId, attachmentId, fileName, buffer, mimeType }) => ({
        path: `orgs/${tenantId}/project-registration-drafts/${draftId}/${attachmentId}-${fileName}`,
        name: fileName,
        size: buffer.byteLength,
        contentType: mimeType,
        uploadedAt: '2026-07-10T00:00:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const { db, service, base } = createHarness({ storageService });
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-doc-create',
      payload: validRegistrationV2Payload({
        contractDocument: { path: 'browser-controlled', downloadURL: 'https://public.example/secret' },
      }),
    });
    const attachmentBase = {
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      documentKind: 'contract',
      mimeType: 'application/pdf',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    };
    await service.addAttachment({
      ...attachmentBase,
      idempotencyKey: 'idem-submit-doc-first',
      expectedDraftRevision: 0,
      fileName: 'old-contract.pdf',
    });
    await service.addAttachment({
      ...attachmentBase,
      idempotencyKey: 'idem-submit-doc-latest',
      expectedDraftRevision: 1,
      fileName: 'latest-contract.pdf',
    });
    addRequiredRegistrationAttachments(
      db,
      created.body.draft.draftId,
      db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`).attachmentRefs,
    );

    await service.submit({
      ...base,
      idempotencyKey: 'idem-submit-doc-final',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 2,
    });

    const project = db.documents.get('orgs/tenant-a/projects/project-1');
    expect(project.contractDocument).toBeNull();
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .not.toHaveProperty('attachmentRefs');
    expect(db.documents.get('outbox/outbox-1').payload.attachmentRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ documentKind: 'contract', name: 'latest-contract.pdf' }),
      expect.objectContaining({ documentKind: 'customer_business_registration' }),
      expect.objectContaining({ documentKind: 'quote' }),
      expect.objectContaining({ documentKind: 'rfp_request_evidence' }),
    ]));
  });

  it('rejects adopted attachment paths outside the current private draft prefix', async () => {
    const legacyPath = 'orgs/tenant-a/projectRequestDrafts/registration-actor-a';
    const { db, service, base } = createHarness({
      seed: {
        [legacyPath]: {
          ownerUid: 'actor-a',
          status: 'DRAFT',
          payloadSnapshot: validRegistrationPayload(),
          attachmentRefs: [{
            attachmentId: 'legacy-contract',
            documentKind: 'contract',
            path: 'orgs/tenant-a/project-registration-drafts/another-draft/legacy-contract.pdf',
            name: 'legacy-contract.pdf',
          }],
        },
      },
    });
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-adopted-path-create',
    });

    await expectHttpError(service.submit({
      ...base,
      idempotencyKey: 'idem-submit-adopted-path',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    }), 422, 'draft_attachment_invalid');

    expect(db.documents.has('orgs/tenant-a/projects/project-1')).toBe(false);
    expect(db.documents.get(`orgs/tenant-a/projectRequestDrafts/${created.body.draft.draftId}`))
      .toMatchObject({ status: 'ACTIVE', attachmentRefs: [expect.objectContaining({ attachmentId: 'legacy-contract' })] });
  });

  it('preserves current financial flag semantics by inferring positive stored amounts', async () => {
    const { db, service, base } = createHarness();
    const payload = validRegistrationV2Payload({
      type: 'I1',
      supportAmount: 0,
      financialYears: [
        { year: 2026, contractAmount: 100_000, salesVatAmount: 10_000, totalRevenueAmount: 40_000, supportAmount: 0, profitRate: 0.4, confirmed: true },
        { year: 2027, contractAmount: 200_000, salesVatAmount: 20_000, totalRevenueAmount: 80_000, supportAmount: 0, profitRate: 0.4, confirmed: true },
      ],
    });
    delete payload.financialInputFlags;
    const created = await service.create({
      ...base,
      idempotencyKey: 'idem-submit-financial-flags-create',
      payload,
    });
    addRequiredRegistrationAttachments(db, created.body.draft.draftId);
    await service.submit({
      ...base,
      idempotencyKey: 'idem-submit-financial-flags',
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
    });

    expect(db.documents.get('orgs/tenant-a/projects/project-1').financialInputFlags).toEqual({
      contractAmount: true,
      salesVatAmount: true,
      totalRevenueAmount: true,
      supportAmount: false,
    });
  });

  it('rejects a reused PATCH key when two safe payloads differ', async () => {
    const { service, base } = createHarness();
    const created = await service.create({ ...base, idempotencyKey: 'idem-patch-safe-create' });
    const common = {
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      idempotencyKey: 'idem-patch-safe-conflict',
      expectedDraftRevision: 0,
    };

    await service.update({ ...common, payload: { profile: { name: 'first' } } });

    await expectHttpError(
      service.update({ ...common, payload: { profile: { name: 'second' } } }),
      409,
      'idempotency_conflict',
    );
  });

  it.each([
    ['nested own __proto__', () => ({
      payload: JSON.parse('{"profile":{"__proto__":{"displayName":"different"}}}'),
    })],
    ['root array', () => ({ payload: [] })],
    ['missing payload', () => ({})],
  ])('rejects a %s PATCH payload before fingerprinting without writes', async (_label, createPatchInput) => {
    const { db, service, base, auditChainService } = createHarness();
    const created = await service.create({ ...base, idempotencyKey: 'idem-invalid-patch-create' });
    const draftPath = 'orgs/tenant-a/projectRequestDrafts/draft-1';
    const beforeDraft = clone(db.documents.get(draftPath));
    const beforeIdempotencyCount = [...db.documents.keys()]
      .filter((path) => path.includes('/idempotency_keys/')).length;
    const beforeAuditCount = auditChainService.appendManyInTransaction.mock.calls.length;

    await expectHttpError(
      service.update({
        ...base,
        draftId: created.body.draft.draftId,
        leaseId: created.body.lease.leaseId,
        fence: created.body.lease.fence,
        idempotencyKey: 'idem-invalid-patch',
        expectedDraftRevision: 0,
        ...createPatchInput(),
      }),
      422,
      'draft_payload_invalid',
    );

    expect(db.documents.get(draftPath)).toEqual(beforeDraft);
    expect([...db.documents.keys()].filter((path) => path.includes('/idempotency_keys/')))
      .toHaveLength(beforeIdempotencyCount);
    expect(auditChainService.appendManyInTransaction).toHaveBeenCalledTimes(beforeAuditCount);
  });

  it('rejects a draft document above the safe Firestore size before writing it', async () => {
    const { db, service, base, auditChainService } = createHarness();
    const created = await service.create({ ...base, idempotencyKey: 'idem-size-create' });

    await expectHttpError(service.update({
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      idempotencyKey: 'idem-size-patch',
      expectedDraftRevision: 0,
      payload: { text: 'x'.repeat(901 * 1024) },
    }), 413, 'draft_payload_too_large');

    expect(db.documents.get('orgs/tenant-a/projectRequestDrafts/draft-1').draftRevision).toBe(0);
    expect(auditChainService.appendManyInTransaction).toHaveBeenCalledTimes(1);
  });

  it('deletes the superseded private object after a same-kind replacement commits', async () => {
    let uploadCount = 0;
    const storageService = {
      uploadDraftAttachment: vi.fn(async ({ tenantId, draftId, attachmentId, fileName, buffer, mimeType }) => ({
        path: `orgs/${tenantId}/project-registration-drafts/${draftId}/${attachmentId}-${++uploadCount}-${fileName}`,
        name: fileName,
        size: buffer.byteLength,
        contentType: mimeType,
        uploadedAt: '2026-07-10T00:00:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const { service, base } = createHarness({ storageService });
    const created = await service.create({ ...base, idempotencyKey: 'idem-replace-create' });
    const common = {
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      documentKind: 'contract',
      mimeType: 'application/pdf',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    };
    const first = await service.addAttachment({
      ...common, idempotencyKey: 'idem-replace-first', expectedDraftRevision: 0, fileName: 'first.pdf',
    });
    await service.addAttachment({
      ...common, idempotencyKey: 'idem-replace-second', expectedDraftRevision: 1, fileName: 'second.pdf',
    });

    expect(storageService.deleteDraftAttachment).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      draftId: created.body.draft.draftId,
      path: first.body.attachment.path,
    });
  });

  it('deletes only the just-uploaded object when the post-upload transaction conflicts', async () => {
    const deleted = [];
    let uploadCount = 0;
    let db;
    const storageService = {
      uploadDraftAttachment: vi.fn(async ({ tenantId, draftId, attachmentId, fileName, buffer, mimeType }) => {
        uploadCount += 1;
        const path = `orgs/${tenantId}/project-registration-drafts/${draftId}/${attachmentId}-${fileName}`;
        if (uploadCount === 2) {
          await db.doc(`orgs/${tenantId}/projectRequestDrafts/${draftId}`).set({ draftRevision: 2 }, { merge: true });
        }
        return { path, name: fileName, size: buffer.byteLength, contentType: mimeType, uploadedAt: '2026-07-10T00:00:00.000Z' };
      }),
      deleteDraftAttachment: vi.fn(async ({ path }) => {
        deleted.push(path);
        throw new Error('sensitive cleanup detail: orgs/tenant-a/private/contract.pdf');
      }),
    };
    const harness = createHarness({ storageService });
    db = harness.db;
    const { service, base } = harness;
    const created = await service.create({ ...base, idempotencyKey: 'idem-attachment-create' });
    const common = {
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      documentKind: 'contract',
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    };

    const first = await service.addAttachment({
      ...common,
      idempotencyKey: 'idem-attachment-1',
      expectedDraftRevision: 0,
    });
    const firstPath = first.body.attachment.path;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expectHttpError(
        service.addAttachment({
          ...common,
          idempotencyKey: 'idem-attachment-2',
          expectedDraftRevision: 1,
        }),
        409,
        'draft_version_conflict',
      );
      expect(warn).toHaveBeenCalledWith('[bff] draft attachment cleanup failed', {
        requestId: 'request-a',
        errorCode: 'draft_attachment_cleanup_failed',
      });
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/sensitive cleanup detail|contract\.pdf|orgs\/tenant-a/i);
    } finally {
      warn.mockRestore();
    }

    expect(deleted).toEqual([
      'orgs/tenant-a/project-registration-drafts/draft-1/attachment-2-contract.pdf',
    ]);
    expect(db.documents.get('orgs/tenant-a/projectRequestDrafts/draft-1').attachmentRefs)
      .toEqual([expect.objectContaining({ path: firstPath })]);
  });

  it('rejects non-PDF MIME types and fake PDF content before private storage', async () => {
    const storageService = {
      uploadDraftAttachment: vi.fn(),
      deleteDraftAttachment: vi.fn(),
    };
    const { service, base } = createHarness({ storageService });
    const created = await service.create({ ...base, idempotencyKey: 'idem-pdf-validation-create' });
    const attachment = {
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      expectedDraftRevision: 0,
      documentKind: 'contract',
      fileName: 'contract.pdf',
    };

    await expectHttpError(service.addAttachment({
      ...attachment,
      idempotencyKey: 'idem-pdf-validation-mime',
      mimeType: 'text/plain',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    }), 422, 'draft_attachment_invalid');
    const fakePdf = Buffer.from('not-a-pdf');
    await expectHttpError(service.addAttachment({
      ...attachment,
      idempotencyKey: 'idem-pdf-validation-magic',
      mimeType: 'application/pdf',
      fileSize: fakePdf.byteLength,
      buffer: fakePdf,
    }), 422, 'draft_attachment_invalid');
    expect(storageService.uploadDraftAttachment).not.toHaveBeenCalled();
  });

  it('rejects a reused attachment key when only the raw file bytes differ', async () => {
    const storageService = {
      uploadDraftAttachment: vi.fn(async ({ tenantId, draftId, attachmentId, fileName, buffer, mimeType }) => ({
        path: `orgs/${tenantId}/project-registration-drafts/${draftId}/${attachmentId}-${fileName}`,
        name: fileName,
        size: buffer.byteLength,
        contentType: mimeType,
        uploadedAt: '2026-07-10T00:00:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const { service, base } = createHarness({ storageService });
    const created = await service.create({ ...base, idempotencyKey: 'idem-attachment-bytes-create' });
    const firstPdf = Buffer.from('%PDF-A');
    const secondPdf = Buffer.from('%PDF-B');
    const common = {
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      idempotencyKey: 'idem-attachment-bytes',
      expectedDraftRevision: 0,
      documentKind: 'contract',
      fileName: 'bytes.pdf',
      mimeType: 'application/pdf',
      fileSize: firstPdf.byteLength,
    };

    await service.addAttachment({ ...common, buffer: firstPdf });

    await expectHttpError(
      service.addAttachment({ ...common, buffer: secondPdf }),
      409,
      'idempotency_conflict',
    );
    expect(storageService.uploadDraftAttachment).toHaveBeenCalledTimes(1);
    expect(storageService.deleteDraftAttachment).not.toHaveBeenCalled();
  });
});

describe('project registration draft routes', () => {
  function createRouteApp({ enabled = true } = {}) {
    const service = {
      create: vi.fn(async () => ({ status: 201, replayed: false, body: { draft: { draftId: 'draft-a' }, lease: { leaseId: 'lease-a' } } })),
      get: vi.fn(async () => ({ draft: { draftId: 'draft-a' } })),
      update: vi.fn(async () => ({ status: 200, replayed: false, body: { draft: { draftId: 'draft-a', draftRevision: 1 } } })),
      addAttachment: vi.fn(async () => ({ status: 200, replayed: false, body: { draft: { draftId: 'draft-a', draftRevision: 2 } } })),
      submit: vi.fn(async () => ({
        status: 201,
        replayed: false,
        body: { projectId: 'project-a', projectRequestId: 'request-a', draftId: 'draft-a', draftRevision: 2 },
      })),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'tenant-a',
        actorId: 'actor-a',
        actorRole: 'pm',
        actorName: 'Actor A',
        requestId: 'request-a',
        idempotencyKey: req.header('idempotency-key') || undefined,
      };
      next();
    });
    mountProjectRegistrationDraftRoutes(app, {
      enabled,
      projectRegistrationDraftService: service,
      piiProtector: { encryptText: vi.fn(async () => ({ ciphertext: 'encrypted-email' })) },
    });
    app.use((error, _req, res, _next) => {
      res.status(error.statusCode || 500).json({ error: error.code || 'internal_error', message: error.message });
    });
    return { app, service };
  }

  it('does not mount the private API when the Stage lease flag is disabled', async () => {
    const { app } = createRouteApp({ enabled: false });
    await request(app).post('/api/v1/project-registration-drafts').send({}).expect(404);
  });

  it('passes revision and lease headers to PATCH without using the global mutating wrapper', async () => {
    const { app, service } = createRouteApp();

    const response = await request(app)
      .patch('/api/v1/project-registration-drafts/draft-a')
      .set({
        'idempotency-key': 'idem-route-patch',
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '4',
      })
      .send({ expectedDraftRevision: 0, payload: { name: 'Saved' }, stepIndex: 2 })
      .expect(200);

    expect(response.body.draft).toMatchObject({ draftId: 'draft-a', draftRevision: 1 });
    expect(service.update).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      actorRole: 'pm',
      draftId: 'draft-a',
      sessionId: 'session-a',
      leaseId: 'lease-a',
      fence: 4,
      idempotencyKey: 'idem-route-patch',
      expectedDraftRevision: 0,
      payload: { name: 'Saved' },
      stepIndex: 2,
    }));
  });

  it('passes only expected revision and lease headers to atomic submit', async () => {
    const { app, service } = createRouteApp();

    const response = await request(app)
      .post('/api/v1/project-registration-drafts/draft-a/submit')
      .set({
        'idempotency-key': 'idem-route-submit',
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '4',
      })
      .send({ expectedDraftRevision: 1 })
      .expect(201);

    expect(response.body).toMatchObject({ projectId: 'project-a', projectRequestId: 'request-a' });
    expect(service.submit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      draftId: 'draft-a',
      sessionId: 'session-a',
      leaseId: 'lease-a',
      fence: 4,
      idempotencyKey: 'idem-route-submit',
      expectedDraftRevision: 1,
    }));

    await request(app)
      .post('/api/v1/project-registration-drafts/draft-a/submit')
      .set({
        'idempotency-key': 'idem-route-submit-extra',
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '4',
      })
      .send({ expectedDraftRevision: 1, projectId: 'browser-controlled' })
      .expect(400);
  });

  it('requires a typed private attachment kind and forwards it to storage registration', async () => {
    const { app, service } = createRouteApp();
    const headers = {
      'idempotency-key': 'idem-route-attachment-kind',
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': 'lease-a',
      'x-edit-fence': '4',
    };
    const body = {
      expectedDraftRevision: 1,
      documentKind: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      fileSize: VALID_PDF.byteLength,
      contentBase64: VALID_PDF.toString('base64'),
    };

    await request(app)
      .post('/api/v1/project-registration-drafts/draft-a/attachments')
      .set(headers)
      .send(body)
      .expect(200);
    expect(service.addAttachment).toHaveBeenCalledWith(expect.objectContaining({ documentKind: 'quote' }));

    await request(app)
      .post('/api/v1/project-registration-drafts/draft-a/attachments')
      .set({ ...headers, 'idempotency-key': 'idem-route-attachment-kind-missing' })
      .send({ ...body, documentKind: undefined })
      .expect(400);
  });

  it('returns 422 for a root array before the real create service writes anything', async () => {
    const harness = createHarness();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'tenant-a',
        actorId: 'actor-a',
        actorRole: 'pm',
        actorName: 'Actor A',
        requestId: 'request-array',
        idempotencyKey: req.header('idempotency-key') || undefined,
      };
      next();
    });
    mountProjectRegistrationDraftRoutes(app, {
      enabled: true,
      projectRegistrationDraftService: harness.service,
    });
    app.use((error, _req, res, _next) => {
      res.status(error.statusCode || 500).json({ error: error.code || 'internal_error' });
    });

    const response = await request(app)
      .post('/api/v1/project-registration-drafts')
      .set({
        'idempotency-key': 'idem-route-root-array',
        'x-edit-session-id': 'session-a',
      })
      .send({ payload: [], stepIndex: 0 })
      .expect(422);

    expect(response.body.error).toBe('draft_payload_invalid');
    expect([...harness.db.documents.keys()].filter((path) => path.includes('/projectRequestDrafts/')))
      .toHaveLength(0);
    expect([...harness.db.documents.keys()].filter((path) => path.includes('/idempotency_keys/')))
      .toHaveLength(0);
    expect(harness.auditChainService.appendManyInTransaction).not.toHaveBeenCalled();
  });
});
