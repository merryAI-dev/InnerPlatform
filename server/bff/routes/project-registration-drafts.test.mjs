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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));

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

  return {
    documents,
    doc,
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: async (ref) => snapshot(ref.path),
        set: (ref, value, options = {}) => writes.push({ type: 'set', ref, value: clone(value), options }),
        create: (ref, value) => writes.push({ type: 'create', ref, value: clone(value) }),
        update: (ref, value) => writes.push({ type: 'update', ref, value: clone(value) }),
      };
      const result = await callback(tx);
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
    },
  };
}

function createHarness({ seed = {}, storageService, nowMs = Date.parse('2026-07-10T00:00:00.000Z') } = {}) {
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
  const auditChainService = {
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
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 3,
      buffer: Buffer.from('pdf'),
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
    const common = {
      ...base,
      draftId: created.body.draft.draftId,
      leaseId: created.body.lease.leaseId,
      fence: created.body.lease.fence,
      idempotencyKey: 'idem-attachment-bytes',
      expectedDraftRevision: 0,
      fileName: 'bytes.bin',
      mimeType: 'application/octet-stream',
      fileSize: 1,
    };

    await service.addAttachment({ ...common, buffer: Buffer.from([0xff]) });

    await expectHttpError(
      service.addAttachment({ ...common, buffer: Buffer.from([0xfe]) }),
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
