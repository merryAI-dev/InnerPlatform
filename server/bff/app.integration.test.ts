import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBffApp } from './app.mjs';
import { createFirestoreDb } from './firestore.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('BFF integration (Firestore emulator)', () => {
  const projectId = 'demo-bff-it';
  const tenantId = 'mysc';
  const actorId = 'u001';
  const workerSecret = 'it-worker-secret';
  const defaultHeaders = {
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-role': 'admin',
  };

  const db = createFirestoreDb({ projectId });
  const app = createBffApp({ projectId, workerSecret });
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
      'change_events',
      'views',
      'members',
      'outbox_deliveries',
      'idempotency_keys',
      'relation_rules',
    ];

    for (const collectionName of collections) {
      await clearCollection(`orgs/${tenantId}/${collectionName}`);
    }

    await clearCollection('outbox');
    await clearCollection('work_queue');
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

  it('rejects disallowed CORS origin', async () => {
    const corsApi = request(createBffApp({
      projectId,
      allowedOrigins: 'http://localhost:5173',
    }));

    const denied = await corsApi
      .get('/api/v1/health')
      .set('origin', 'https://evil.example.com');

    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('origin_not_allowed');
  });

  it('enforces firebase_required auth mode and blocks header spoofing', async () => {
    const verifier = vi.fn(async (token: string) => {
      if (token !== 'valid-token') {
        throw new Error('invalid token');
      }
      return {
        uid: actorId,
        email: 'admin@mysc.co.kr',
        role: 'admin',
        tenantId,
      };
    });

    const secureApi = request(createBffApp({
      projectId,
      authMode: 'firebase_required',
      tokenVerifier: verifier,
    }));

    const missingToken = await secureApi
      .get('/api/v1/projects')
      .set(defaultHeaders);

    expect(missingToken.status).toBe(401);
    expect(missingToken.body.error).toBe('missing_bearer_token');

    const ok = await secureApi
      .get('/api/v1/projects')
      .set({ ...defaultHeaders, authorization: 'Bearer valid-token' });

    expect(ok.status).toBe(200);

    const spoofed = await secureApi
      .get('/api/v1/projects')
      .set({
        ...defaultHeaders,
        'x-actor-id': 'spoofed-user',
        authorization: 'Bearer valid-token',
      });

    expect(spoofed.status).toBe(403);
    expect(spoofed.body.error).toBe('actor_mismatch');
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

  it('supports deterministic cursor pagination for project list', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-page-project-1' })
      .send({ id: 'p-page-001', name: 'Paged Project 1' });
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-page-project-2' })
      .send({ id: 'p-page-002', name: 'Paged Project 2' });
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-page-project-3' })
      .send({ id: 'p-page-003', name: 'Paged Project 3' });

    const firstPage = await api
      .get('/api/v1/projects?limit=2')
      .set(defaultHeaders);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.count).toBe(2);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await api
      .get(`/api/v1/projects?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`)
      .set(defaultHeaders);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.count).toBe(1);

    const seenIds = new Set([
      ...firstPage.body.items.map((item: any) => item.id),
      ...secondPage.body.items.map((item: any) => item.id),
    ]);
    expect(seenIds.size).toBe(3);
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

  it('blocks demoting the last remaining admin (lockout protection)', async () => {
    await db.doc(`orgs/${tenantId}/members/u-admin-1`).set({
      uid: 'u-admin-1',
      tenantId,
      role: 'admin',
      email: 'admin1@example.com',
      updatedAt: new Date().toISOString(),
    });

    const denied = await api
      .patch('/api/v1/members/u-admin-1/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'admin', 'idempotency-key': 'idem-last-admin-demote' })
      .send({ role: 'viewer', reason: 'test lockout prevention' });

    expect(denied.status).toBe(409);
    expect(denied.body.error).toBe('last_admin_lockout');

    await db.doc(`orgs/${tenantId}/members/u-admin-2`).set({
      uid: 'u-admin-2',
      tenantId,
      role: 'admin',
      email: 'admin2@example.com',
      updatedAt: new Date().toISOString(),
    });

    const ok = await api
      .patch('/api/v1/members/u-admin-2/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'admin', 'idempotency-key': 'idem-second-admin-demote' })
      .send({ role: 'viewer', reason: 'leaving one admin' });

    expect(ok.status).toBe(200);
    expect(ok.body.previousRole).toBe('admin');
    expect(ok.body.role).toBe('viewer');
  });

  it('enforces permission-level RBAC for transaction state changes (submit vs approve)', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-perm-project-001' })
      .send({ id: 'p-perm-001', name: 'Permission Project' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-perm-ledger-001' })
      .send({ id: 'l-perm-001', projectId: 'p-perm-001', name: 'Permission Ledger' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-perm-tx-001' })
      .send({ id: 'tx-perm-001', projectId: 'p-perm-001', ledgerId: 'l-perm-001', counterparty: 'Vendor' });

    const submitted = await api
      .patch('/api/v1/transactions/tx-perm-001/state')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm', 'idempotency-key': 'idem-perm-submit-001' })
      .send({ newState: 'SUBMITTED', expectedVersion: 1 });

    expect(submitted.status).toBe(200);
    expect(submitted.body.state).toBe('SUBMITTED');

    const deniedApprove = await api
      .patch('/api/v1/transactions/tx-perm-001/state')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm', 'idempotency-key': 'idem-perm-approve-deny-001' })
      .send({ newState: 'APPROVED', expectedVersion: 2 });

    expect(deniedApprove.status).toBe(403);
    expect(deniedApprove.body.error).toBe('forbidden');

    const approved = await api
      .patch('/api/v1/transactions/tx-perm-001/state')
      .set({ ...defaultHeaders, 'x-actor-role': 'finance', 'idempotency-key': 'idem-perm-approve-allow-001' })
      .send({ newState: 'APPROVED', expectedVersion: 2 });

    expect(approved.status).toBe(200);
    expect(approved.body.state).toBe('APPROVED');
  });

  it('enforces route-level RBAC for audit reads and write APIs', async () => {
    const deniedAudit = await api
      .get('/api/v1/audit-logs')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm' });

    expect(deniedAudit.status).toBe(403);
    expect(deniedAudit.body.error).toBe('forbidden');

    const deniedWrite = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-rbac-deny-write' })
      .send({ id: 'p-rbac-denied', name: 'Denied Project' });

    expect(deniedWrite.status).toBe(403);
    expect(deniedWrite.body.error).toBe('forbidden');
  });

  it('writes through generic pipeline and synchronizes projection views', async () => {
    const createProject = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-project-001' })
      .send({
        entityType: 'project',
        entityId: 'p-gw-001',
        patch: {
          id: 'p-gw-001',
          name: 'Pipeline Project',
        },
      });

    expect(createProject.status).toBe(201);
    expect(createProject.body.eventId).toBeTruthy();
    expect(createProject.body.affectedViews).toContain('project_financials');

    const createLedger = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-ledger-001' })
      .send({
        entityType: 'ledger',
        entityId: 'l-gw-001',
        patch: {
          id: 'l-gw-001',
          projectId: 'p-gw-001',
          name: 'Pipeline Ledger',
        },
      });
    expect(createLedger.status).toBe(201);

    const createTx = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-tx-001' })
      .send({
        entityType: 'transaction',
        entityId: 'tx-gw-001',
        patch: {
          id: 'tx-gw-001',
          projectId: 'p-gw-001',
          ledgerId: 'l-gw-001',
          counterparty: 'Pipeline Vendor',
          direction: 'OUT',
          state: 'SUBMITTED',
          amounts: {
            bankAmount: 150000,
          },
          submittedBy: actorId,
          submittedAt: '2026-02-14T12:00:00.000Z',
        },
      });

    expect(createTx.status).toBe(201);
    expect(createTx.body.affectedViews).toContain('approval_inbox');

    const financials = await api
      .get('/api/v1/views/project_financials?projectId=p-gw-001')
      .set(defaultHeaders);
    expect(financials.status).toBe(200);
    expect(financials.body.item).toBeTruthy();
    expect(financials.body.item.projectId).toBe('p-gw-001');

    const inbox = await api
      .get('/api/v1/views/approval_inbox')
      .set(defaultHeaders);
    expect(inbox.status).toBe(200);
    expect(inbox.body.totalPending).toBeGreaterThanOrEqual(1);
    const hasTx = (inbox.body.items || []).some((item: any) => item.itemId === 'tx-gw-001');
    expect(hasTx).toBe(true);

    const queueJobs = await api
      .get('/api/v1/queue/jobs?eventId=' + encodeURIComponent(createTx.body.eventId))
      .set(defaultHeaders);
    expect(queueJobs.status).toBe(200);
    expect(queueJobs.body.count).toBeGreaterThanOrEqual(1);
  });

  it('replays queue jobs from a change event', async () => {
    const write = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-replay-seed' })
      .send({
        entityType: 'member',
        entityId: 'u-replay-001',
        patch: {
          id: 'u-replay-001',
          name: 'Replay User',
          role: 'pm',
          email: 'replay@example.com',
        },
      });

    expect(write.status).toBe(201);
    expect(write.body.eventId).toBeTruthy();

    const replay = await api
      .post(`/api/v1/queue/replay/${write.body.eventId}`)
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-replay-run' })
      .send({});

    expect(replay.status).toBe(200);
    expect(replay.body.queued).toBeGreaterThanOrEqual(1);

    const jobs = await api
      .get('/api/v1/queue/jobs?eventId=' + encodeURIComponent(write.body.eventId))
      .set(defaultHeaders);
    expect(jobs.status).toBe(200);
    expect(jobs.body.count).toBeGreaterThanOrEqual(1);
  });

  it('rejects internal worker endpoints without a valid secret', async () => {
    const deniedQueue = await api
      .post('/api/internal/workers/work-queue/run')
      .send({});
    expect(deniedQueue.status).toBe(401);
    expect(deniedQueue.body.error).toBe('unauthorized_worker');

    const deniedOutbox = await api
      .post('/api/internal/workers/outbox/run')
      .send({});
    expect(deniedOutbox.status).toBe(401);
    expect(deniedOutbox.body.error).toBe('unauthorized_worker');
  });

  it('processes work queue jobs through internal worker endpoint', async () => {
    const write = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-worker-queue-seed' })
      .send({
        entityType: 'project',
        entityId: 'p-worker-queue-001',
        patch: {
          id: 'p-worker-queue-001',
          name: 'Queue Worker Seed',
        },
        options: {
          sync: false,
        },
      });

    expect(write.status).toBe(201);
    expect(write.body.eventId).toBeTruthy();

    const runQueue = await api
      .post('/api/internal/workers/work-queue/run')
      .set('x-worker-secret', workerSecret)
      .send({ tenantId, eventId: write.body.eventId });

    expect(runQueue.status).toBe(200);
    expect(runQueue.body.ok).toBe(true);
    expect(runQueue.body.worker).toBe('work_queue');
    expect(runQueue.body.processed).toBeGreaterThanOrEqual(1);

    const jobs = await api
      .get(`/api/v1/queue/jobs?eventId=${encodeURIComponent(write.body.eventId)}`)
      .set(defaultHeaders);

    expect(jobs.status).toBe(200);
    expect(jobs.body.count).toBeGreaterThanOrEqual(1);
    const allDone = (jobs.body.items || []).every((item: any) => item.status === 'DONE');
    expect(allDone).toBe(true);
  });

  it('processes outbox events through internal worker endpoint', async () => {
    const createProject = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-worker-outbox-seed' })
      .send({
        id: 'p-worker-outbox-001',
        name: 'Outbox Worker Seed',
      });
    expect(createProject.status).toBe(201);

    const pendingBefore = await db
      .collection('outbox')
      .where('status', '==', 'PENDING')
      .limit(5)
      .get();
    expect(pendingBefore.empty).toBe(false);

    const runOutbox = await api
      .post('/api/internal/workers/outbox/run')
      .set('x-worker-secret', workerSecret)
      .send({});

    expect(runOutbox.status).toBe(200);
    expect(runOutbox.body.ok).toBe(true);
    expect(runOutbox.body.worker).toBe('outbox');
    expect(runOutbox.body.processed).toBeGreaterThanOrEqual(1);
    expect(runOutbox.body.succeeded).toBeGreaterThanOrEqual(1);

    const doneAfter = await db
      .collection('outbox')
      .where('status', '==', 'DONE')
      .limit(5)
      .get();
    expect(doneAfter.empty).toBe(false);
  });
});
