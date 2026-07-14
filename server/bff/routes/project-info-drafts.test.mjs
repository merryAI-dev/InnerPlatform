import { describe, expect, it, vi } from 'vitest';
import { createIdempotencyService } from '../idempotency.mjs';
import { buildActiveEditLeaseDocument, resolveEditLeaseDocumentId } from '../edit-lease.mjs';
import { loadRbacPolicy } from '../rbac-policy.mjs';
import {
  createProjectInfoDraftService,
  createProjectInfoSubmittedOutboxHandler,
} from './project-info-drafts.mjs';

const VALID_PDF = Buffer.from('%PDF-1.4\n');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  function snapshot(path) {
    const exists = documents.has(path);
    return { exists, id: path.split('/').at(-1), data: () => (exists ? clone(documents.get(path)) : undefined) };
  }
  function doc(path) {
    return {
      path,
      get: async () => snapshot(path),
      set: async (value, options = {}) => documents.set(
        path,
        options.merge && documents.has(path) ? { ...documents.get(path), ...clone(value) } : clone(value),
      ),
    };
  }
  return {
    documents,
    doc,
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: async (ref) => snapshot(ref.path),
        set: (ref, value, options = {}) => writes.push({ type: 'set', ref, value: clone(value), options }),
        create: (ref, value) => writes.push({ type: 'create', ref, value: clone(value), options: {} }),
      };
      const result = await callback(tx);
      for (const write of writes) {
        const current = documents.get(write.ref.path);
        if (write.type === 'create' && current !== undefined) throw new Error('document already exists');
        documents.set(write.ref.path, write.options.merge && current
          ? { ...current, ...write.value }
          : write.value);
      }
      return result;
    },
  };
}

function validPayload(overrides = {}) {
  return {
    name: 'Project A',
    officialContractName: 'Project A contract',
    type: 'D1',
    status: 'IN_PROGRESS',
    phase: 'CONFIRMED',
    description: 'Before',
    clientOrg: 'Client',
    department: 'AXR',
    currency: 'KRW',
    contractAmount: 100000,
    salesVatAmount: 10000,
    totalRevenueAmount: 40000,
    supportAmount: 0,
    financialInputFlags: { contractAmount: true },
    contractStart: '2026-07-01',
    contractEnd: '2026-12-31',
    contractType: '계약서(날인)',
    settlementType: 'TYPE1',
    basis: '공급가액',
    accountType: 'OPERATING',
    fundInputMode: 'BANK_UPLOAD',
    paymentPlan: { contract: 100000, interim: 0, final: 0 },
    paymentPlanDesc: '선금 100%',
    settlementGuide: '',
    finalPaymentNote: '',
    projectPurpose: 'Purpose',
    registeredById: 'actor-a',
    registeredByName: 'Actor A',
    managerId: 'actor-a',
    managerName: 'Actor A',
    teamName: 'AXR',
    teamMembers: '',
    teamMembersDetailed: [],
    participantCondition: '',
    note: '',
    contractDocument: null,
    quoteDocument: null,
    proposalDocument: null,
    contractAnalysis: null,
    ...overrides,
  };
}

function harness({ storageService } = {}) {
  let nowMs = Date.parse('2026-07-12T00:00:00.000Z');
  const lease = buildActiveEditLeaseDocument({
    tenantId: 'tenant-a', resourceType: 'project-info', resourceId: 'project-a',
    actorId: 'actor-a', actorDisplayName: 'Actor A', sessionId: 'session-a',
    leaseId: 'lease-a', serverNow: nowMs,
  });
  const db = createDb({
    'orgs/tenant-a/members/actor-a': {
      uid: 'actor-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/members/actor-admin': {
      uid: 'actor-admin', role: 'admin', status: 'ACTIVE', projectIds: [],
    },
    'orgs/tenant-a/projects/project-a': {
      id: 'project-a', tenantId: 'tenant-a', version: 3, executiveReviewStatus: 'APPROVED',
      executiveReviewHistory: [], ...validPayload(),
    },
    [`orgs/tenant-a/editLeases/${resolveEditLeaseDocumentId('project-info', 'project-a')}`]: lease,
  });
  const auditChainService = { appendManyInTransaction: vi.fn(async () => []) };
  const idempotencyService = createIdempotencyService(db, { now: () => new Date(nowMs) });
  const service = createProjectInfoDraftService({
    db,
    now: () => new Date(nowMs).toISOString(),
    createAttachmentId: () => 'attachment-a',
    createOutboxEvent: (input) => ({
      id: 'outbox-a', ...input, status: 'PENDING', attempts: 0,
      nextAttemptAt: input.createdAt, updatedAt: input.createdAt,
    }),
    auditChainService,
    idempotencyService,
    draftStorageService: storageService,
    rbacPolicy: loadRbacPolicy(),
  });
  const base = {
    tenantId: 'tenant-a', actorId: 'actor-a', actorDisplayName: 'Actor A',
    actorEmail: 'actor-a@example.com', actorRole: 'pm', requestId: 'request-a',
    projectId: 'project-a', sessionId: 'session-a', leaseId: 'lease-a', fence: 1,
  };
  return { db, service, base, auditChainService, advance: (ms) => { nowMs += ms; } };
}

async function openedDraft(h, key = 'open-a') {
  return h.service.open({ ...h.base, idempotencyKey: key });
}

describe('project information private drafts', () => {
  it('skips a delayed attachment event after a newer request replaced it', async () => {
    const requestPath = 'orgs/tenant-a/project_requests/change-project-a';
    const db = createDb({
      [requestPath]: {
        targetProjectId: 'project-a',
        requestVersion: 2,
        targetProjectVersion: 5,
        submittedOutboxId: 'outbox-new',
        payload: { contractDocument: { path: 'new-contract.pdf' } },
        proposedSnapshot: { contractDocument: { path: 'new-contract.pdf' } },
      },
      'outbox/outbox-old': { status: 'PROCESSING', claimToken: 'claim-old' },
    });
    const relocateDraftAttachments = vi.fn(async () => [{
      documentKind: 'contract',
      path: 'orgs/tenant-a/project-registration-documents/project-a/old-contract.pdf',
      name: 'old-contract.pdf',
      size: 3,
      contentType: 'application/pdf',
    }]);
    const handler = createProjectInfoSubmittedOutboxHandler({
      db,
      draftStorageService: { relocateDraftAttachments },
      now: () => '2026-07-12T00:05:00.000Z',
    });

    await handler({
      id: 'outbox-old',
      claimToken: 'claim-old',
      tenantId: 'tenant-a',
      payload: {
        projectId: 'project-a',
        projectRequestId: 'change-project-a',
        draftId: 'draft-old',
        requestVersion: 1,
        targetProjectVersion: 4,
        attachmentRefs: [{ documentKind: 'contract', path: 'private-old.pdf' }],
      },
    });

    expect(relocateDraftAttachments).not.toHaveBeenCalled();
    expect(db.documents.get(requestPath)).toMatchObject({
      submittedOutboxId: 'outbox-new',
      payload: { contractDocument: { path: 'new-contract.pdf' } },
      proposedSnapshot: { contractDocument: { path: 'new-contract.pdf' } },
    });
  });

  it('opens an owner-only draft from canonical data and hides it from admins', async () => {
    const h = harness();
    h.db.documents.set('orgs/tenant-a/members/actor-a', {
      ...h.db.documents.get('orgs/tenant-a/members/actor-a'), projectIds: [],
    });
    const opened = await openedDraft(h);

    expect(opened).toMatchObject({
      status: 200,
      body: { draft: {
        projectId: 'project-a', resourceType: 'project-info', draftRevision: 0,
        baseCanonicalVersion: 3, payload: { name: 'Project A' }, status: 'ACTIVE',
      } },
    });
    await expect(h.service.get({
      tenantId: 'tenant-a', actorId: 'actor-admin', projectId: 'project-a',
    })).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
  });

  it('temporary save changes only the private draft and rejects stale revisions', async () => {
    const h = harness();
    await openedDraft(h);
    const saved = await h.service.update({
      ...h.base,
      idempotencyKey: 'save-a',
      expectedDraftRevision: 0,
      payload: validPayload({ name: 'Private changed name' }),
      stepIndex: 2,
    });

    expect(saved.body.draft).toMatchObject({ draftRevision: 1, payload: { name: 'Private changed name' } });
    expect(h.db.documents.get('orgs/tenant-a/projects/project-a').name).toBe('Project A');
    expect(h.db.documents.has('orgs/tenant-a/project_requests/change-project-a')).toBe(false);
    await expect(h.service.update({
      ...h.base,
      idempotencyKey: 'save-stale',
      expectedDraftRevision: 0,
      payload: validPayload({ name: 'Stale' }),
    })).rejects.toMatchObject({ statusCode: 409, code: 'draft_version_conflict' });
  });

  it('submits request, metadata-only draft, canonical version, lease, audit, idempotency and outbox atomically', async () => {
    const h = harness();
    await openedDraft(h);
    await h.service.update({
      ...h.base, idempotencyKey: 'save-a', expectedDraftRevision: 0,
      payload: validPayload({ name: 'Submitted name', browserOnlyField: 'must not persist' }), stepIndex: 4,
    });
    const submitInput = {
      ...h.base,
      idempotencyKey: 'submit-a',
      expectedDraftRevision: 1,
      expectedVersion: 3,
      resubmit: true,
      reviewComment: '보완 완료',
    };
    const submitted = await h.service.submit(submitInput);
    const replay = await h.service.submit(submitInput);

    const project = h.db.documents.get('orgs/tenant-a/projects/project-a');
    const request = h.db.documents.get('orgs/tenant-a/project_requests/change-project-a');
    const draft = [...h.db.documents.entries()].find(([path]) => path.includes('/privateEditDrafts/'))[1];
    const storedLease = h.db.documents.get(`orgs/tenant-a/editLeases/${resolveEditLeaseDocumentId('project-info', 'project-a')}`);
    expect(submitted.body).toMatchObject({
      status: 'SUBMITTED', projectId: 'project-a', projectRequestId: 'change-project-a',
      projectVersion: 4, draftRevision: 2, lease: { state: 'RELEASED', canEdit: false },
      outbox: { id: 'outbox-a', status: 'PENDING' },
    });
    expect(project).toMatchObject({ name: 'Project A', version: 4, executiveReviewStatus: 'PENDING' });
    expect(request).toMatchObject({
      requestKind: 'CHANGE', status: 'PENDING', baseProjectVersion: 3,
      targetProjectVersion: 4, requestVersion: 1, submittedOutboxId: 'outbox-a',
      proposedSnapshot: { name: 'Submitted name' },
    });
    expect(h.db.documents.has('orgs/tenant-a/projectRequests/change-project-a')).toBe(false);
    expect(request.proposedSnapshot).not.toHaveProperty('browserOnlyField');
    expect(draft).toMatchObject({ status: 'SUBMITTED', draftRevision: 2, submittedProjectRequestId: 'change-project-a' });
    expect(draft).not.toHaveProperty('payload');
    expect(draft).not.toHaveProperty('attachmentRefs');
    expect(storedLease).toMatchObject({ state: 'RELEASED', releaseReason: 'FINAL_SUBMIT' });
    expect(h.db.documents.get('outbox/outbox-a')).toMatchObject({
      eventType: 'project.info.submitted',
      payload: { requestVersion: 1, targetProjectVersion: 4 },
    });
    expect([...h.db.documents.keys()].some((path) => path.includes('/idempotency_keys/'))).toBe(true);
    expect(h.auditChainService.appendManyInTransaction).toHaveBeenCalled();
    expect(replay).toEqual({ ...submitted, replayed: true });
  });

  it('preserves completed-project checkout and three private evidence PDFs in the change request', async () => {
    const storage = {
      uploadDraftAttachment: vi.fn(async (input) => ({
        path: `orgs/${input.tenantId}/project-registration-drafts/${input.draftId}/${input.attachmentId}-${input.fileName}`,
        name: input.fileName,
        size: input.buffer.byteLength,
        contentType: input.mimeType,
        uploadedAt: '2026-07-12T00:01:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const h = harness({ storageService: storage });
    await openedDraft(h);
    const kinds = ['performance_certificate', 'tax_invoice', 'final_settlement_report'];
    for (const [revision, documentKind] of kinds.entries()) {
      await h.service.addAttachment({
        ...h.base,
        idempotencyKey: `checkout-upload-${documentKind}`,
        expectedDraftRevision: revision,
        documentKind,
        fileName: `${documentKind}.pdf`,
        mimeType: 'application/pdf',
        fileSize: VALID_PDF.byteLength,
        buffer: VALID_PDF,
      });
    }
    await h.service.update({
      ...h.base,
      idempotencyKey: 'checkout-save',
      expectedDraftRevision: 3,
      payload: validPayload({
        status: 'COMPLETED',
        checkout: {
          finalPaymentReceived: true,
          bankBalanceZero: true,
          performanceCertificateReceived: true,
          taxInvoiceEvidenceConfirmed: true,
          finalSettlementReportConfirmed: true,
          usbEvidenceSubmitted: true,
          evidenceDeletedAfterUsb: true,
        },
      }),
    });

    await h.service.submit({
      ...h.base,
      idempotencyKey: 'checkout-submit',
      expectedDraftRevision: 4,
      expectedVersion: 3,
    });

    const request = h.db.documents.get('orgs/tenant-a/project_requests/change-project-a');
    expect(request.proposedSnapshot).toMatchObject({
      checkout: {
        finalPaymentReceived: true,
        bankBalanceZero: true,
        performanceCertificateReceived: true,
        taxInvoiceEvidenceConfirmed: true,
        finalSettlementReportConfirmed: true,
        usbEvidenceSubmitted: true,
        evidenceDeletedAfterUsb: true,
      },
      performanceCertificateDocument: { documentKind: 'performance_certificate' },
      taxInvoiceDocument: { documentKind: 'tax_invoice' },
      finalSettlementReportDocument: { documentKind: 'final_settlement_report' },
    });
    expect(h.db.documents.get('outbox/outbox-a').payload.attachmentRefs.map((item) => item.documentKind)).toEqual(kinds);
  });

  it('rejects a completed-project evidence confirmation without the matching PDF', async () => {
    const h = harness();
    await openedDraft(h);
    await h.service.update({
      ...h.base,
      idempotencyKey: 'checkout-invalid-save',
      expectedDraftRevision: 0,
      payload: validPayload({
        status: 'COMPLETED',
        checkout: {
          finalPaymentReceived: true,
          bankBalanceZero: true,
          performanceCertificateReceived: true,
          taxInvoiceEvidenceConfirmed: false,
          finalSettlementReportConfirmed: false,
          usbEvidenceSubmitted: false,
          evidenceDeletedAfterUsb: false,
        },
      }),
    });

    await expect(h.service.submit({
      ...h.base,
      idempotencyKey: 'checkout-invalid-submit',
      expectedDraftRevision: 1,
      expectedVersion: 3,
    })).rejects.toMatchObject({ statusCode: 422, code: 'project_registration_invalid' });
    expect(h.db.documents.has('orgs/tenant-a/project_requests/change-project-a')).toBe(false);
  });

  it('fails closed on canonical version drift without partial writes', async () => {
    const h = harness();
    await openedDraft(h);
    await h.service.update({
      ...h.base, idempotencyKey: 'save-a', expectedDraftRevision: 0,
      payload: validPayload({ name: 'Must remain private' }),
    });
    h.db.documents.set('orgs/tenant-a/projects/project-a', {
      ...h.db.documents.get('orgs/tenant-a/projects/project-a'), version: 4,
    });

    await expect(h.service.submit({
      ...h.base, idempotencyKey: 'submit-conflict', expectedDraftRevision: 1, expectedVersion: 3,
    })).rejects.toMatchObject({ statusCode: 409, code: 'canonical_version_conflict' });
    expect(h.db.documents.has('orgs/tenant-a/project_requests/change-project-a')).toBe(false);
    expect(h.db.documents.has('outbox/outbox-a')).toBe(false);
    expect([...h.db.documents.values()].find((value) => value?.resourceType === 'project-info' && value?.ownerUid))
      .toMatchObject({ status: 'ACTIVE', payload: { name: 'Must remain private' } });
  });

  it('uploads into the private owner draft path and saves metadata only after storage succeeds', async () => {
    const storage = {
      uploadDraftAttachment: vi.fn(async (input) => ({
        path: `orgs/${input.tenantId}/project-registration-drafts/${input.draftId}/${input.attachmentId}-${input.fileName}`,
        name: input.fileName,
        size: input.buffer.byteLength,
        contentType: input.mimeType,
        uploadedAt: '2026-07-12T00:01:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const h = harness({ storageService: storage });
    await openedDraft(h);
    const uploaded = await h.service.addAttachment({
      ...h.base,
      idempotencyKey: 'upload-a',
      expectedDraftRevision: 0,
      documentKind: 'contract',
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    });
    const replaced = await h.service.addAttachment({
      ...h.base,
      idempotencyKey: 'upload-b',
      expectedDraftRevision: 1,
      documentKind: 'contract',
      fileName: 'replacement.pdf',
      mimeType: 'application/pdf',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    });

    expect(uploaded.body).toMatchObject({
      draft: { draftRevision: 1, attachmentRefs: [{ documentKind: 'contract', name: 'contract.pdf' }] },
    });
    expect(storage.uploadDraftAttachment).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', draftId: expect.stringMatching(/^v1_/), actorId: 'actor-a',
    }));
    expect(replaced.body.draft.attachmentRefs).toHaveLength(1);
    expect(replaced.body.draft.attachmentRefs[0].name).toBe('replacement.pdf');
  });

  it('maps a new original-document kind into the canonical change request field', async () => {
    const storage = {
      uploadDraftAttachment: vi.fn(async (input) => ({
        path: `orgs/${input.tenantId}/project-registration-drafts/${input.draftId}/${input.attachmentId}-${input.fileName}`,
        name: input.fileName,
        size: input.buffer.byteLength,
        contentType: input.mimeType,
        uploadedAt: '2026-07-12T00:01:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const h = harness({ storageService: storage });
    await openedDraft(h);
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    await h.service.addAttachment({
      ...h.base,
      idempotencyKey: 'proposal-word-upload',
      expectedDraftRevision: 0,
      documentKind: 'proposal_word_original',
      fileName: 'proposal.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: docx.byteLength,
      buffer: docx,
    });
    await h.service.submit({
      ...h.base,
      idempotencyKey: 'proposal-word-submit',
      expectedDraftRevision: 1,
      expectedVersion: 3,
    });

    expect(h.db.documents.get('orgs/tenant-a/project_requests/change-project-a').proposedSnapshot)
      .toMatchObject({ proposalWordOriginalDocument: { documentKind: 'proposal_word_original' } });
  });

  it('allows a same-kind replacement when the private attachment list is at its limit', async () => {
    const storage = {
      uploadDraftAttachment: vi.fn(async (input) => ({
        path: `orgs/${input.tenantId}/project-registration-drafts/${input.draftId}/${input.attachmentId}-${input.fileName}`,
        name: input.fileName,
        size: input.buffer.byteLength,
        contentType: input.mimeType,
        uploadedAt: '2026-07-12T00:01:00.000Z',
      })),
      deleteDraftAttachment: vi.fn(async () => undefined),
    };
    const h = harness({ storageService: storage });
    await openedDraft(h);
    const [draftPath] = [...h.db.documents.keys()].filter((path) => path.includes('/privateEditDrafts/'));
    const draft = h.db.documents.get(draftPath);
    h.db.documents.set(draftPath, {
      ...draft,
      attachmentRefs: [
        { attachmentId: 'old-contract', documentKind: 'contract', path: 'private/old-contract.pdf' },
        ...Array.from({ length: 99 }, (_, index) => ({
          attachmentId: `proposal-${index}`,
          documentKind: 'proposal',
          path: `private/proposal-${index}.pdf`,
        })),
      ],
    });

    const replaced = await h.service.addAttachment({
      ...h.base,
      idempotencyKey: 'upload-at-limit',
      expectedDraftRevision: 0,
      documentKind: 'contract',
      fileName: 'replacement.pdf',
      mimeType: 'application/pdf',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    });

    expect(replaced.body.draft.attachmentRefs).toHaveLength(100);
    expect(replaced.body.draft.attachmentRefs.filter((item) => item.documentKind === 'contract'))
      .toEqual([expect.objectContaining({ name: 'replacement.pdf' })]);
  });

  it('rejects non-PDF MIME types and fake PDF content before private storage', async () => {
    const storage = {
      uploadDraftAttachment: vi.fn(),
      deleteDraftAttachment: vi.fn(),
    };
    const h = harness({ storageService: storage });
    await openedDraft(h);
    const attachment = {
      ...h.base,
      expectedDraftRevision: 0,
      documentKind: 'contract',
      fileName: 'contract.pdf',
    };

    await expect(h.service.addAttachment({
      ...attachment,
      idempotencyKey: 'upload-invalid-mime',
      mimeType: 'text/plain',
      fileSize: VALID_PDF.byteLength,
      buffer: VALID_PDF,
    })).rejects.toMatchObject({ statusCode: 422, code: 'draft_attachment_invalid' });
    const fakePdf = Buffer.from('not-a-pdf');
    await expect(h.service.addAttachment({
      ...attachment,
      idempotencyKey: 'upload-invalid-magic',
      mimeType: 'application/pdf',
      fileSize: fakePdf.byteLength,
      buffer: fakePdf,
    })).rejects.toMatchObject({ statusCode: 422, code: 'draft_attachment_invalid' });
    expect(storage.uploadDraftAttachment).not.toHaveBeenCalled();
  });
});
