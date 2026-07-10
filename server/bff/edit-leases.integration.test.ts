import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createBffApp } from './app.mjs';
import { EDIT_LEASE_TTL_MS } from './edit-lease.mjs';
import { createFirestoreDb } from './firestore.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('edit leases (Firestore emulator)', () => {
  const projectId = 'demo-bff-it';
  const tenantId = 'edit-leases-it';
  const actorId = 'actor-a';
  let nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  const db = createFirestoreDb({ projectId });
  const api = request(createBffApp({
    projectId,
    db,
    authMode: 'headers',
    now: () => new Date(nowMs).toISOString(),
    env: {
      ...process.env,
      BFF_DEPLOY_ENV: 'stage',
      BFF_SCHEDULER_OWNER: 'disabled',
      BFF_EDIT_LEASES_ENABLED: 'true',
    },
  }));

  const baseHeaders = {
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-role': 'pm',
    'x-actor-name': 'Actor A',
  };

  async function clearCollection(path: string) {
    const snap = await db.collection(path).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  async function clearData() {
    await Promise.all([
      'editLeases',
      'projects',
      'members',
      'projectRequestDrafts',
      'audit_logs',
      'audit_chain',
    ].map((collection) => clearCollection(`orgs/${tenantId}/${collection}`)));
  }

  async function resetData() {
    await clearData();
    const batch = db.batch();
    batch.set(db.doc(`orgs/${tenantId}/members/${actorId}`), {
      uid: actorId,
      role: 'pm',
      status: 'ACTIVE',
      projectIds: ['project-a', 'project-b'],
    });
    batch.set(db.doc(`orgs/${tenantId}/projects/project-a`), { id: 'project-a' });
    batch.set(db.doc(`orgs/${tenantId}/projects/project-b`), { id: 'project-b' });
    batch.set(db.doc(`orgs/${tenantId}/projectRequestDrafts/draft-a`), { ownerUid: actorId });
    await batch.commit();
    nowMs = Date.parse('2026-07-10T00:00:00.000Z');
  }

  function acquire(resourceType: string, resourceId: string, sessionId: string, key: string) {
    return api
      .post(`/api/v1/edit-leases/${resourceType}/${resourceId}/acquire`)
      .set({
        ...baseHeaders,
        'x-edit-session-id': sessionId,
        'idempotency-key': key,
      })
      .send({});
  }

  // Firestore emulator cold-start cleanup can exceed the shared 30s hook limit.
  beforeEach(resetData, 60_000);
  afterAll(clearData, 60_000);

  it('serializes concurrent same-actor tabs so exactly one acquires the resource', async () => {
    const responses = await Promise.all([
      acquire('project-info', 'project-a', 'session-a', 'idem-race-a'),
      acquire('project-info', 'project-a', 'session-b', 'idem-race-b'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 423]);
    const conflict = responses.find((response) => response.status === 423)!;
    expect(conflict.body.details).toEqual({
      holderDisplayName: 'Actor A',
      sameActor: true,
      expiresAt: '2026-07-10T00:30:00.000Z',
    });
    expect(JSON.stringify(conflict.body)).not.toMatch(/actor-a|session-[ab]|leaseId|fence|@/i);
  });

  it('allows a project and an owned registration draft to acquire independently', async () => {
    const responses = await Promise.all([
      acquire('cashflow', 'project-b', 'session-project', 'idem-independent-project'),
      acquire('project-registration', 'draft-a', 'session-draft', 'idem-independent-draft'),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[0].body.leaseId).not.toBe(responses[1].body.leaseId);
  });

  it('reacquires at exact expiry and rejects the previous fence', async () => {
    const first = await acquire('project-info', 'project-a', 'session-old', 'idem-expiry-old');
    expect(first.status).toBe(200);
    nowMs += EDIT_LEASE_TTL_MS;

    const second = await acquire('project-info', 'project-a', 'session-new', 'idem-expiry-new');
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ fence: first.body.fence + 1 });
    expect(second.body.leaseId).not.toBe(first.body.leaseId);

    const stale = await api
      .post('/api/v1/edit-leases/project-info/project-a/extend')
      .set({
        ...baseHeaders,
        'x-edit-session-id': 'session-old',
        'x-edit-lease-id': first.body.leaseId,
        'x-edit-fence': String(first.body.fence),
        'idempotency-key': 'idem-expiry-stale',
      })
      .send({});

    expect(stale.status).toBe(423);
    expect(stale.body.error).toBe('edit_lease_held');
  });
});
