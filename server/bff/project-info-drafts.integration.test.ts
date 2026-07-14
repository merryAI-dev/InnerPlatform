import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBffApp } from './app.mjs';
import { createFirestoreDb } from './firestore.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const VALID_PDF = Buffer.from('%PDF-1.4\n');

describeIfEmulator('project information private drafts (Firestore emulator)', () => {
  const firebaseProjectId = 'demo-project-info-drafts';
  const tenantId = 'tenant-project-info-drafts';
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  let nowMs = Date.parse('2026-07-12T00:00:00.000Z');
  let attachmentSequence = 0;
  let outboxSequence = 0;
  const relocated: string[] = [];
  const storage = {
    uploadDraftAttachment: vi.fn(async (input: Record<string, any>) => ({
      path: `orgs/${input.tenantId}/project-registration-drafts/${input.draftId}/${input.attachmentId}-${input.fileName}`,
      name: input.fileName,
      size: input.buffer.byteLength,
      contentType: input.mimeType,
      uploadedAt: new Date(nowMs).toISOString(),
    })),
    deleteDraftAttachment: vi.fn(async () => undefined),
    relocateDraftAttachments: vi.fn(async (input: Record<string, any>) => input.attachmentRefs.map((attachment: Record<string, any>) => {
      const path = `orgs/${input.tenantId}/project-registration-documents/${input.projectId}/${String(attachment.path).split('/').at(-1)}`;
      relocated.push(path);
      return { ...attachment, path, visibility: 'PRIVATE' };
    })),
  };
  const api = request(createBffApp({
    projectId: firebaseProjectId,
    db,
    authMode: 'headers',
    now: () => new Date(nowMs).toISOString(),
    createProjectInfoAttachmentId: () => `info-attachment-${++attachmentSequence}`,
    createProjectInfoOutboxEvent: (input: Record<string, any>) => ({
      id: `project-info-outbox-${++outboxSequence}`,
      ...input,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: input.createdAt,
      updatedAt: input.createdAt,
    }),
    projectRegistrationDraftStorageService: storage,
    workerSecret: 'project-info-worker-secret',
    workerAuthPolicy: {
      deployEnv: 'local', schedulerOwner: 'manual',
      secrets: { manual: 'project-info-worker-secret', vercel: '', k8s: '' },
    },
    env: {
      ...process.env,
      BFF_DEPLOY_ENV: 'stage',
      BFF_SCHEDULER_OWNER: 'disabled',
      BFF_EDIT_LEASES_ENABLED: 'true',
    },
  }));

  function actorHeaders(actorId = 'actor-a', role = 'pm') {
    return {
      'x-tenant-id': tenantId,
      'x-actor-id': actorId,
      'x-actor-role': role,
      'x-actor-name': actorId,
      'x-actor-email': `${actorId}@example.com`,
    };
  }

  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Project A', officialContractName: 'Project A contract', type: 'D1',
      status: 'IN_PROGRESS', phase: 'CONFIRMED', description: 'Before', clientOrg: 'Client',
      department: 'AXR', currency: 'KRW', contractAmount: 100000, salesVatAmount: 10000,
      totalRevenueAmount: 40000, supportAmount: 0, financialInputFlags: { contractAmount: true },
      contractStart: '2026-07-01', contractEnd: '2026-12-31', contractType: '계약서(날인)',
      settlementType: 'TYPE1', basis: '공급가액', accountType: 'OPERATING', fundInputMode: 'BANK_UPLOAD',
      paymentPlan: { contract: 100000, interim: 0, final: 0 }, paymentPlanDesc: '선금 100%',
      settlementGuide: '', finalPaymentNote: '', projectPurpose: 'Purpose',
      registeredById: 'actor-a', registeredByName: 'actor-a', managerId: 'actor-a', managerName: 'actor-a',
      teamName: 'AXR', teamMembers: '', teamMembersDetailed: [], participantCondition: '', note: '',
      contractDocument: null, quoteDocument: null, proposalDocument: null, contractAnalysis: null,
      ...overrides,
    };
  }

  async function clearCollection(path: string) {
    const snap = await db.collection(path).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }

  async function reset() {
    await Promise.all([
      'members', 'projects', 'project_requests', 'projectRequests', 'privateEditDrafts', 'editLeases',
      'audit_logs', 'audit_chain', 'idempotency_keys', 'outbox_deliveries',
    ].map((name) => clearCollection(`orgs/${tenantId}/${name}`)));
    await clearCollection('outbox');
    const batch = db.batch();
    batch.set(db.doc(`orgs/${tenantId}/members/actor-a`), {
      uid: 'actor-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    });
    batch.set(db.doc(`orgs/${tenantId}/members/actor-admin`), {
      uid: 'actor-admin', role: 'admin', status: 'ACTIVE', projectIds: [],
    });
    batch.set(db.doc(`orgs/${tenantId}/projects/project-a`), {
      id: 'project-a', tenantId, version: 3, executiveReviewStatus: 'APPROVED',
      executiveReviewHistory: [], ...validPayload(),
    });
    await batch.commit();
    nowMs = Date.parse('2026-07-12T00:00:00.000Z');
    attachmentSequence = 0;
    outboxSequence = 0;
    relocated.length = 0;
    vi.clearAllMocks();
  }

  async function acquire() {
    return api
      .post('/api/v1/edit-leases/project-info/project-a/acquire')
      .set({ ...actorHeaders(), 'x-edit-session-id': 'session-a', 'idempotency-key': 'lease-acquire-a' })
      .send({});
  }

  function mutationHeaders(lease: any, key: string) {
    return {
      ...actorHeaders(),
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': lease.leaseId,
      'x-edit-fence': String(lease.fence),
      'idempotency-key': key,
    };
  }

  beforeEach(reset, 60_000);
  afterAll(reset, 60_000);

  it('keeps temporary data owner-only and atomically publishes only the final change request', async () => {
    const acquired = await acquire();
    expect(acquired.status).toBe(200);
    const headers = mutationHeaders(acquired.body, 'draft-open-a');
    const opened = await api.post('/api/v1/project-info-drafts/project-a/open').set(headers).send({});
    expect(opened.status).toBe(200);
    const saved = await api.patch('/api/v1/project-info-drafts/project-a')
      .set({ ...headers, 'idempotency-key': 'draft-save-a' })
      .send({ expectedDraftRevision: 0, payload: validPayload({ name: 'Private name' }), stepIndex: 4 });
    expect(saved.status).toBe(200);
    expect((await db.doc(`orgs/${tenantId}/projects/project-a`).get()).data()?.name).toBe('Project A');
    expect((await db.doc(`orgs/${tenantId}/project_requests/change-project-a`).get()).exists).toBe(false);

    const adminRead = await api.get('/api/v1/project-info-drafts/project-a').set(actorHeaders('actor-admin', 'admin'));
    expect(adminRead.status).toBe(404);

    const submitted = await api.post('/api/v1/project-info-drafts/project-a/submit')
      .set({ ...headers, 'idempotency-key': 'draft-submit-a' })
      .send({ expectedDraftRevision: 1, expectedVersion: 3, resubmit: false });
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ projectVersion: 4, lease: { state: 'RELEASED' } });
    const [project, changeRequest, drafts] = await Promise.all([
      db.doc(`orgs/${tenantId}/projects/project-a`).get(),
      db.doc(`orgs/${tenantId}/project_requests/change-project-a`).get(),
      db.collection(`orgs/${tenantId}/privateEditDrafts`).get(),
    ]);
    expect(project.data()).toMatchObject({ name: 'Project A', version: 4 });
    expect(changeRequest.data()).toMatchObject({ status: 'PENDING', proposedSnapshot: { name: 'Private name' } });
    expect((await db.doc(`orgs/${tenantId}/projectRequests/change-project-a`).get()).exists).toBe(false);
    expect(drafts.docs[0].data()).not.toHaveProperty('payload');
  });

  it('relocates same-kind private attachments through outbox and leaves version conflicts private', async () => {
    const acquired = await acquire();
    const baseHeaders = mutationHeaders(acquired.body, 'draft-open-b');
    const opened = await api.post('/api/v1/project-info-drafts/project-a/open').set(baseHeaders).send({});
    const uploaded = await api.post('/api/v1/project-info-drafts/project-a/attachments')
      .set({ ...baseHeaders, 'idempotency-key': 'draft-upload-b' })
      .send({
        expectedDraftRevision: opened.body.draft.draftRevision,
        documentKind: 'contract', fileName: 'contract.pdf', mimeType: 'application/pdf',
        fileSize: VALID_PDF.byteLength, contentBase64: VALID_PDF.toString('base64'),
      });
    expect(uploaded.status).toBe(200);
    await db.doc(`orgs/${tenantId}/projects/project-a`).set({ version: 4 }, { merge: true });
    const conflict = await api.post('/api/v1/project-info-drafts/project-a/submit')
      .set({ ...baseHeaders, 'idempotency-key': 'draft-submit-conflict' })
      .send({ expectedDraftRevision: 1, expectedVersion: 3 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('canonical_version_conflict');
    expect((await db.doc(`orgs/${tenantId}/project_requests/change-project-a`).get()).exists).toBe(false);
    expect((await db.collection('outbox').get()).empty).toBe(true);

    await db.doc(`orgs/${tenantId}/projects/project-a`).set({ version: 3 }, { merge: true });
    const submitted = await api.post('/api/v1/project-info-drafts/project-a/submit')
      .set({ ...baseHeaders, 'idempotency-key': 'draft-submit-b' })
      .send({ expectedDraftRevision: 1, expectedVersion: 3 });
    expect(submitted.status).toBe(200);
    const worker = await api.post('/api/internal/workers/outbox/run')
      .set({ 'x-worker-secret': 'project-info-worker-secret' })
      .send({ limit: 10 });
    expect(worker.status).toBe(200);
    expect(worker.body.succeeded).toBe(1);
    expect(relocated).toHaveLength(1);
    expect((await db.doc(`orgs/${tenantId}/project_requests/change-project-a`).get()).data())
      .toMatchObject({ proposedSnapshot: { contractDocument: { path: relocated[0] } } });
  });

  it('lets the persisted project owner acquire without a duplicated member assignment', async () => {
    await db.doc(`orgs/${tenantId}/members/actor-a`).set({ projectIds: [] }, { merge: true });
    const acquired = await acquire();
    expect(acquired.status).toBe(200);
    expect(acquired.body).toMatchObject({ state: 'ACTIVE', canEdit: true });
  });
});
