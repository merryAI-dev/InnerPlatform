import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createBffApp } from './app.mjs';
import { createFirestoreDb } from './firestore.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('BFF integration (Firestore emulator)', () => {
  const projectId = 'demo-bff-it';
  const tenantId = 'mysc';
  const actorId = 'u001';
  const defaultHeaders = {
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-role': 'admin',
  };

  const db = createFirestoreDb({ projectId });
  const app = createBffApp({ projectId });
  const api = request(app);

  async function clearCollection(path: string): Promise<void> {
    const snap = await db.collection(path).get();
    if (snap.empty) return;

    const chunks: Array<typeof snap.docs> = [];
    for (let i = 0; i < snap.docs.length; i += 400) {
      chunks.push(snap.docs.slice(i, i + 400));
    }

    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  async function resetTenantData(): Promise<void> {
    const collections = [
      'projects',
      'ledgers',
      'transactions',
      'comments',
      'evidences',
      'audit_logs',
      'audit_chain',
      'members',
      'outbox_deliveries',
      'idempotency_keys',
    ];

    for (const collectionName of collections) {
      await clearCollection(`orgs/${tenantId}/${collectionName}`);
    }

    await clearCollection('outbox');
  }

  beforeAll(async () => {
    await resetTenantData();
  });

  beforeEach(async () => {
    await resetTenantData();
  });

  afterAll(async () => {
    await resetTenantData();
  });

  it('returns health metadata', async () => {
    const response = await api.get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.projectId).toBe(projectId);
  });

  it('handles project upsert idempotency and version conflicts', async () => {
    const createPayload = {
      id: 'p-bff-001',
      name: 'BFF Integration Project',
      slug: 'bff-integration-project',
      status: 'IN_PROGRESS',
    };

    const first = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-001' })
      .send(createPayload);

    expect(first.status).toBe(201);
    expect(first.body.id).toBe(createPayload.id);
    expect(first.body.version).toBe(1);

    const replay = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-001' })
      .send(createPayload);

    expect(replay.status).toBe(201);
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(replay.body.version).toBe(1);

    const noExpectedVersion = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-update-001' })
      .send({ ...createPayload, name: 'Updated without version' });

    expect(noExpectedVersion.status).toBe(409);
    expect(noExpectedVersion.body.error).toBe('version_required');

    const update = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-update-002' })
      .send({ ...createPayload, name: 'Updated with version', expectedVersion: 1 });

    expect(update.status).toBe(200);
    expect(update.body.version).toBe(2);

    const wrongVersion = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-update-003' })
      .send({ ...createPayload, name: 'Wrong version', expectedVersion: 1 });

    expect(wrongVersion.status).toBe(409);
    expect(wrongVersion.body.error).toBe('version_conflict');

    const conflict = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-001' })
      .send({ ...createPayload, name: 'Different Project Name' });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('idempotency_conflict');
  });

  it('supports ledger and transaction upsert with validation', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-001' })
      .send({ id: 'p-bff-002', name: 'Project 2' });

    const missingProject = await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-404' })
      .send({ id: 'l404', projectId: 'no-project', name: 'Invalid ledger' });

    expect(missingProject.status).toBe(404);

    const ledger = await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-create-001' })
      .send({ id: 'l001', projectId: 'p-bff-002', name: 'Main Ledger' });

    expect(ledger.status).toBe(201);
    expect(ledger.body.version).toBe(1);

    const ledgerUpdate = await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-update-001' })
      .send({ id: 'l001', projectId: 'p-bff-002', name: 'Main Ledger V2', expectedVersion: 1 });

    expect(ledgerUpdate.status).toBe(200);
    expect(ledgerUpdate.body.version).toBe(2);

    const tx = await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-tx-create-001' })
      .send({
        id: 'tx001',
        projectId: 'p-bff-002',
        ledgerId: 'l001',
        counterparty: 'Vendor A',
      });

    expect(tx.status).toBe(201);
    expect(tx.body.state).toBe('DRAFT');
    expect(tx.body.version).toBe(1);

    const txList = await api
      .get('/api/v1/transactions')
      .set(defaultHeaders);

    expect(txList.status).toBe(200);
    expect(txList.body.count).toBe(1);
  });

  it('enforces deterministic state transitions and version checks', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-003' })
      .send({ id: 'p-bff-003', name: 'Project 3' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-ledger-003' })
      .send({ id: 'l003', projectId: 'p-bff-003', name: 'Ledger 3' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-tx-003' })
      .send({ id: 'tx003', projectId: 'p-bff-003', ledgerId: 'l003', counterparty: 'Vendor C' });

    const invalidTransition = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-invalid-003' })
      .send({ newState: 'APPROVED', expectedVersion: 1 });

    expect(invalidTransition.status).toBe(400);
    expect(invalidTransition.body.message).toMatch(/Invalid state transition/);

    const submitted = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-submit-003' })
      .send({ newState: 'SUBMITTED', expectedVersion: 1 });

    expect(submitted.status).toBe(200);
    expect(submitted.body.state).toBe('SUBMITTED');
    expect(submitted.body.version).toBe(2);

    const noReasonReject = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-reject-003a' })
      .send({ newState: 'REJECTED', expectedVersion: 2 });

    expect(noReasonReject.status).toBe(400);

    const rejected = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-reject-003b' })
      .send({ newState: 'REJECTED', expectedVersion: 2, reason: '증빙 부족' });

    expect(rejected.status).toBe(200);
    expect(rejected.body.state).toBe('REJECTED');
    expect(rejected.body.version).toBe(3);

    const staleVersion = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-resubmit-003a' })
      .send({ newState: 'SUBMITTED', expectedVersion: 2 });

    expect(staleVersion.status).toBe(409);
    expect(staleVersion.body.error).toBe('version_conflict');
  });

  it('creates and lists comments/evidences with immutable audit trail', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-004' })
      .send({ id: 'p-bff-004', name: 'Project 4' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-ledger-004' })
      .send({ id: 'l004', projectId: 'p-bff-004', name: 'Ledger 4' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-tx-004' })
      .send({ id: 'tx004', projectId: 'p-bff-004', ledgerId: 'l004', counterparty: 'Vendor D' });

    const comment = await api
      .post('/api/v1/transactions/tx004/comments')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-comment-004' })
      .send({ content: '검토 요청', authorName: '관리자' });

    expect(comment.status).toBe(201);

    const evidence = await api
      .post('/api/v1/transactions/tx004/evidences')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-evidence-004' })
      .send({
        fileName: 'invoice.pdf',
        fileType: 'application/pdf',
        fileSize: 32000,
        category: '세금계산서',
      });

    expect(evidence.status).toBe(201);

    const comments = await api
      .get('/api/v1/transactions/tx004/comments')
      .set(defaultHeaders);

    const evidences = await api
      .get('/api/v1/transactions/tx004/evidences')
      .set(defaultHeaders);

    expect(comments.status).toBe(200);
    expect(comments.body.count).toBe(1);
    expect(evidences.status).toBe(200);
    expect(evidences.body.count).toBe(1);

    const audits = await api
      .get('/api/v1/audit-logs')
      .set(defaultHeaders);

    expect(audits.status).toBe(200);
    expect(audits.body.count).toBeGreaterThanOrEqual(5);
    const ids = audits.body.items.map((item: any) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    const verify = await api
      .get('/api/v1/audit-logs/verify')
      .set(defaultHeaders);
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.checked).toBeGreaterThanOrEqual(5);
  });

  it('detects tampering in audit hash chain', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-audit' })
      .send({ id: 'p-audit-001', name: 'Audit Project' });

    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-audit-2' })
      .send({ id: 'p-audit-001', name: 'Audit Project v2', expectedVersion: 1 });

    const verifyBefore = await api
      .get('/api/v1/audit-logs/verify')
      .set(defaultHeaders);
    expect(verifyBefore.status).toBe(200);
    expect(verifyBefore.body.ok).toBe(true);

    const firstAudit = await db
      .collection(`orgs/${tenantId}/audit_logs`)
      .orderBy('chainSeq', 'asc')
      .limit(1)
      .get();
    expect(firstAudit.empty).toBe(false);
    await firstAudit.docs[0].ref.set({ details: 'tampered' }, { merge: true });

    const verifyAfter = await api
      .get('/api/v1/audit-logs/verify')
      .set(defaultHeaders);
    expect(verifyAfter.status).toBe(409);
    expect(verifyAfter.body.ok).toBe(false);
    expect(verifyAfter.body.reason).toBe('hash_mismatch');
  });

  it('handles high concurrency with exactly one successful state transition per version', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-race' })
      .send({ id: 'p-race-001', name: 'Race Project' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-ledger-race' })
      .send({ id: 'l-race-001', projectId: 'p-race-001', name: 'Race Ledger' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-tx-race' })
      .send({ id: 'tx-race-001', projectId: 'p-race-001', ledgerId: 'l-race-001', counterparty: 'Race Vendor' });

    const workers = Array.from({ length: 25 }, (_, idx) => (
      api
        .patch('/api/v1/transactions/tx-race-001/state')
        .set({ ...defaultHeaders, 'idempotency-key': `idem-race-${idx}` })
        .send({ newState: 'SUBMITTED', expectedVersion: 1 })
    ));

    const responses = await Promise.all(workers);
    const successCount = responses.filter((r) => r.status === 200).length;
    const conflictCount = responses.filter((r) => r.status === 409 && r.body.error === 'version_conflict').length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(24);
  });

  it('audits member role changes and blocks unauthorized actor role', async () => {
    await db.doc(`orgs/${tenantId}/members/u-target`).set({
      uid: 'u-target',
      tenantId,
      role: 'viewer',
      email: 'target@example.com',
      updatedAt: new Date().toISOString(),
    });

    const forbidden = await api
      .patch('/api/v1/members/u-target/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm', 'idempotency-key': 'idem-role-pm-deny' })
      .send({ role: 'finance', reason: 'test' });

    expect(forbidden.status).toBe(403);

    const changed = await api
      .patch('/api/v1/members/u-target/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'admin', 'idempotency-key': 'idem-role-admin-allow' })
      .send({ role: 'finance', reason: 'quarter close' });

    expect(changed.status).toBe(200);
    expect(changed.body.previousRole).toBe('viewer');
    expect(changed.body.role).toBe('finance');

    const memberSnap = await db.doc(`orgs/${tenantId}/members/u-target`).get();
    expect(memberSnap.data()?.role).toBe('finance');

    const auditSnap = await db
      .collection(`orgs/${tenantId}/audit_logs`)
      .where('entityType', '==', 'member')
      .limit(5)
      .get();
    const roleChangeLog = auditSnap.docs.map((doc) => doc.data()).find((item: any) => item.action === 'ROLE_CHANGE');
    expect(roleChangeLog).toBeTruthy();
  });
});
