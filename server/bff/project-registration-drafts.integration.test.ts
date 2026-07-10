import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBffApp } from './app.mjs';
import { createFirestoreDb } from './firestore.mjs';
import { EDIT_LEASE_TTL_MS, resolveEditLeaseDocumentId } from './edit-lease.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('private project registration drafts (Firestore emulator)', () => {
  const projectId = 'demo-project-registration-drafts';
  const tenantId = 'tenant-drafts';
  const db = createFirestoreDb({ projectId });
  let nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  let draftSequence = 0;
  let leaseSequence = 0;
  let attachmentSequence = 0;
  let uploadHook: null | ((input: Record<string, any>) => Promise<void>) = null;
  const uploadedPaths: string[] = [];
  const deletedPaths: string[] = [];

  const draftStorageService = {
    uploadDraftAttachment: vi.fn(async (input: Record<string, any>) => {
      const path = `orgs/${input.tenantId}/project-registration-drafts/${input.draftId}/${input.attachmentId}-${input.fileName}`;
      uploadedPaths.push(path);
      if (uploadHook) await uploadHook({ ...input, path });
      return {
        path,
        name: input.fileName,
        size: input.buffer.byteLength,
        contentType: input.mimeType,
        uploadedAt: new Date(nowMs).toISOString(),
      };
    }),
    deleteDraftAttachment: vi.fn(async ({ path }: { path: string }) => {
      deletedPaths.push(path);
    }),
  };

  const api = request(createBffApp({
    projectId,
    db,
    authMode: 'headers',
    now: () => new Date(nowMs).toISOString(),
    createProjectRegistrationDraftId: () => `opaque-draft-${++draftSequence}`,
    createProjectRegistrationLeaseId: () => `draft-lease-${++leaseSequence}`,
    createProjectRegistrationAttachmentId: () => `draft-attachment-${++attachmentSequence}`,
    projectRegistrationDraftStorageService: draftStorageService,
    env: {
      ...process.env,
      BFF_DEPLOY_ENV: 'stage',
      BFF_SCHEDULER_OWNER: 'disabled',
      BFF_EDIT_LEASES_ENABLED: 'true',
    },
  }));

  function actorHeaders(actorId = 'actor-a', actorRole = 'pm') {
    return {
      'x-tenant-id': tenantId,
      'x-actor-id': actorId,
      'x-actor-role': actorRole,
      'x-actor-name': actorId,
    };
  }

  function createDraft({
    actorId = 'actor-a',
    actorRole = 'pm',
    sessionId = 'session-a',
    key = 'idem-create',
    body = {},
  }: {
    actorId?: string;
    actorRole?: string;
    sessionId?: string;
    key?: string;
    body?: Record<string, unknown>;
  } = {}) {
    return api
      .post('/api/v1/project-registration-drafts')
      .set({
        ...actorHeaders(actorId, actorRole),
        'x-edit-session-id': sessionId,
        'idempotency-key': key,
      })
      .send(body);
  }

  function mutationHeaders(created: any, key: string, overrides: Record<string, string> = {}) {
    return {
      ...actorHeaders(),
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': created.body.lease.leaseId,
      'x-edit-fence': String(created.body.lease.fence),
      'idempotency-key': key,
      ...overrides,
    };
  }

  async function clearCollection(path: string) {
    const snap = await db.collection(path).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  async function count(path: string) {
    return (await db.collection(path).get()).size;
  }

  async function clearData() {
    await Promise.all([
      'projectRequestDrafts',
      'editLeases',
      'audit_logs',
      'audit_chain',
      'idempotency_keys',
      'projects',
      'project_requests',
      'project_dashboard_projects',
      'members',
    ].map((collection) => clearCollection(`orgs/${tenantId}/${collection}`)));
    await Promise.all([clearCollection('outbox'), clearCollection('work_queue')]);
  }

  async function resetData() {
    await clearData();
    const batch = db.batch();
    for (const [uid, role] of [
      ['actor-a', 'pm'],
      ['actor-b', 'pm'],
      ['actor-finance', 'finance'],
      ['actor-admin', 'admin'],
    ]) {
      batch.set(db.doc(`orgs/${tenantId}/members/${uid}`), {
        uid,
        role,
        status: 'ACTIVE',
        projectIds: [],
      });
    }
    await batch.commit();
    nowMs = Date.parse('2026-07-10T00:00:00.000Z');
    draftSequence = 0;
    leaseSequence = 0;
    attachmentSequence = 0;
    uploadHook = null;
    uploadedPaths.length = 0;
    deletedPaths.length = 0;
    vi.clearAllMocks();
  }

  beforeEach(resetData, 60_000);
  afterAll(clearData, 60_000);

  it('atomically creates exactly one private draft and lease and replays without extending expiry', async () => {
    const createBody = { payload: { name: 'Private only' }, stepIndex: 1 };
    const first = await createDraft({
      body: createBody,
    });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      draft: {
        draftId: 'opaque-draft-1',
        draftRevision: 0,
        payload: { name: 'Private only' },
        status: 'ACTIVE',
      },
      lease: {
        state: 'ACTIVE',
        canEdit: true,
        leaseId: 'draft-lease-1',
        fence: 1,
      },
    });
    expect(await count(`orgs/${tenantId}/projectRequestDrafts`)).toBe(1);
    expect(await count(`orgs/${tenantId}/editLeases`)).toBe(1);
    expect(await count(`orgs/${tenantId}/projects`)).toBe(0);
    expect(await count(`orgs/${tenantId}/project_requests`)).toBe(0);
    expect(await count(`orgs/${tenantId}/project_dashboard_projects`)).toBe(0);
    expect(await count('outbox')).toBe(0);
    expect(await count('work_queue')).toBe(0);
    expect((await db.doc(`orgs/${tenantId}/members/actor-a`).get()).data()?.projectIds).toEqual([]);

    const draft = await db.doc(`orgs/${tenantId}/projectRequestDrafts/opaque-draft-1`).get();
    expect(draft.data()).toMatchObject({
      ownerUid: 'actor-a',
      ownerId: 'actor-a',
      tenantId,
      resourceType: 'project-registration',
      resourceId: 'opaque-draft-1',
      draftRevision: 0,
      attachmentRefs: [],
      status: 'ACTIVE',
    });
    const leaseRef = db.doc(
      `orgs/${tenantId}/editLeases/${resolveEditLeaseDocumentId('project-registration', 'opaque-draft-1')}`,
    );
    const expiresAt = (await leaseRef.get()).data()?.expiresAt;
    const auditCount = await count(`orgs/${tenantId}/audit_logs`);
    nowMs += 60_000;

    const replay = await createDraft({ body: createBody });

    expect(replay.status).toBe(201);
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(replay.body).toEqual(first.body);
    expect((await leaseRef.get()).data()?.expiresAt).toBe(expiresAt);
    expect(await count(`orgs/${tenantId}/projectRequestDrafts`)).toBe(1);
    expect(await count(`orgs/${tenantId}/editLeases`)).toBe(1);
    expect(await count(`orgs/${tenantId}/audit_logs`)).toBe(auditCount);
  });

  it('adopts one unsubmitted owner legacy draft and ignores a foreign legacy owner', async () => {
    const ownerLegacyRef = db.doc(`orgs/${tenantId}/projectRequestDrafts/registration-actor-a`);
    const foreignLegacyRef = db.doc(`orgs/${tenantId}/projectRequestDrafts/registration-actor-b`);
    await ownerLegacyRef.set({
      id: 'registration-actor-a',
      ownerId: 'actor-a',
      payloadSnapshot: { name: 'Preserved legacy', contractDocument: { path: 'legacy.pdf' } },
      stepIndex: 3,
      attachmentRefs: [{ attachmentId: 'legacy-1', path: 'legacy.pdf' }],
      status: 'DRAFT',
      version: 7,
    });
    await foreignLegacyRef.set({
      id: 'registration-actor-b',
      ownerUid: 'someone-else',
      payloadSnapshot: { name: 'Must stay private' },
      status: 'DRAFT',
    });

    const adopted = await createDraft({ key: 'idem-adopt' });
    const second = await createDraft({ key: 'idem-after-adopt' });
    const foreign = await createDraft({ actorId: 'actor-b', sessionId: 'session-b', key: 'idem-foreign' });

    expect(adopted.body.draft).toMatchObject({
      payload: { name: 'Preserved legacy', contractDocument: { path: 'legacy.pdf' } },
      stepIndex: 3,
      attachmentRefs: [{ attachmentId: 'legacy-1', path: 'legacy.pdf' }],
    });
    expect(second.body.draft.payload).toEqual({});
    expect(foreign.body.draft.payload).toEqual({});
    expect((await ownerLegacyRef.get()).data()).toMatchObject({
      payloadSnapshot: { name: 'Preserved legacy', contractDocument: { path: 'legacy.pdf' } },
      migrationStatus: 'ADOPTED',
      adoptedByDraftId: adopted.body.draft.draftId,
    });
    expect((await foreignLegacyRef.get()).data()).toEqual({
      id: 'registration-actor-b',
      ownerUid: 'someone-else',
      payloadSnapshot: { name: 'Must stay private' },
      status: 'DRAFT',
    });
  });

  it('lets only the owner read a preserved draft after lease expiry without renewing it', async () => {
    const created = await createDraft({ key: 'idem-private-get' });
    const leaseRef = db.doc(
      `orgs/${tenantId}/editLeases/${resolveEditLeaseDocumentId('project-registration', created.body.draft.draftId)}`,
    );
    const leaseBefore = (await leaseRef.get()).data();
    nowMs += EDIT_LEASE_TTL_MS;

    const owner = await api
      .get(`/api/v1/project-registration-drafts/${created.body.draft.draftId}`)
      .set(actorHeaders());
    const otherPm = await api
      .get(`/api/v1/project-registration-drafts/${created.body.draft.draftId}`)
      .set(actorHeaders('actor-b', 'pm'));
    const finance = await api
      .get(`/api/v1/project-registration-drafts/${created.body.draft.draftId}`)
      .set(actorHeaders('actor-finance', 'finance'));
    const admin = await api
      .get(`/api/v1/project-registration-drafts/${created.body.draft.draftId}`)
      .set(actorHeaders('actor-admin', 'admin'));

    expect(owner.status).toBe(200);
    expect(owner.body).toEqual({ draft: created.body.draft });
    for (const response of [otherPm, finance, admin]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    }
    expect((await leaseRef.get()).data()).toEqual(leaseBefore);
  });

  it('saves by revision with exact replay and rejects stale, expired, and wrong-session writes', async () => {
    const created = await createDraft({ key: 'idem-patch-create' });
    const path = `/api/v1/project-registration-drafts/${created.body.draft.draftId}`;
    const body = { expectedDraftRevision: 0, payload: { name: 'Temporary save' }, stepIndex: 2 };
    const first = await api.patch(path).set(mutationHeaders(created, 'idem-patch')).send(body);
    const auditCount = await count(`orgs/${tenantId}/audit_logs`);
    const replay = await api.patch(path).set(mutationHeaders(created, 'idem-patch')).send(body);

    expect(first.status).toBe(200);
    expect(first.body.draft).toMatchObject({ draftRevision: 1, payload: body.payload, stepIndex: 2 });
    expect(replay.status).toBe(200);
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(replay.body).toEqual(first.body);
    expect(await count(`orgs/${tenantId}/audit_logs`)).toBe(auditCount);
    expect((await db.doc(`orgs/${tenantId}/projectRequestDrafts/${created.body.draft.draftId}`).get()).data()?.draftRevision).toBe(1);

    const stale = await api
      .patch(path)
      .set(mutationHeaders(created, 'idem-patch-stale'))
      .send({ ...body, expectedDraftRevision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('draft_version_conflict');

    const wrongSession = await api
      .patch(path)
      .set(mutationHeaders(created, 'idem-patch-wrong-session', { 'x-edit-session-id': 'session-b' }))
      .send({ ...body, expectedDraftRevision: 1 });
    expect(wrongSession.status).toBe(423);
    expect(wrongSession.body.error).toBe('edit_lease_held');

    nowMs += EDIT_LEASE_TTL_MS;
    const expired = await api
      .patch(path)
      .set(mutationHeaders(created, 'idem-patch-expired'))
      .send({ ...body, expectedDraftRevision: 1 });
    expect(expired.status).toBe(410);
    expect(expired.body.error).toBe('edit_lease_expired');

    expect(await count(`orgs/${tenantId}/projects`)).toBe(0);
    expect(await count(`orgs/${tenantId}/project_requests`)).toBe(0);
    expect(await count(`orgs/${tenantId}/project_dashboard_projects`)).toBe(0);
    expect(await count('outbox')).toBe(0);
    expect(await count('work_queue')).toBe(0);
    expect((await db.doc(`orgs/${tenantId}/members/actor-a`).get()).data()?.projectIds).toEqual([]);
  });

  it('registers private attachment metadata and deletes only a failed post-upload object', async () => {
    const created = await createDraft({ key: 'idem-attachment-create' });
    const path = `/api/v1/project-registration-drafts/${created.body.draft.draftId}/attachments`;
    const fileBody = {
      expectedDraftRevision: 0,
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 3,
      contentBase64: Buffer.from('pdf').toString('base64'),
    };
    const first = await api
      .post(path)
      .set(mutationHeaders(created, 'idem-attachment-1'))
      .send(fileBody);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      draft: { draftRevision: 1 },
      attachment: {
        attachmentId: 'draft-attachment-1',
        path: expect.stringContaining('/project-registration-drafts/'),
        name: 'contract.pdf',
        size: 3,
        contentType: 'application/pdf',
      },
    });
    const firstPath = first.body.attachment.path;
    expect(deletedPaths).toEqual([]);

    uploadHook = async ({ tenantId: hookTenantId, draftId }) => {
      await db.doc(`orgs/${hookTenantId}/projectRequestDrafts/${draftId}`).set({ draftRevision: 2 }, { merge: true });
    };
    const failed = await api
      .post(path)
      .set(mutationHeaders(created, 'idem-attachment-2'))
      .send({ ...fileBody, expectedDraftRevision: 1, fileName: 'quote.pdf' });

    expect(failed.status).toBe(409);
    expect(failed.body.error).toBe('draft_version_conflict');
    expect(uploadedPaths).toHaveLength(2);
    expect(deletedPaths).toEqual([uploadedPaths[1]]);
    expect(deletedPaths).not.toContain(firstPath);
    const stored = (await db.doc(`orgs/${tenantId}/projectRequestDrafts/${created.body.draft.draftId}`).get()).data();
    expect(stored?.attachmentRefs).toEqual([expect.objectContaining({ path: firstPath })]);
  });
});
