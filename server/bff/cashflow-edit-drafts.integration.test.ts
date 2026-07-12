import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createBffApp } from './app.mjs';
import { createFirestoreDb } from './firestore.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('cashflow private drafts (Firestore emulator)', () => {
  const firebaseProjectId = 'demo-cashflow-edit-drafts';
  const tenantId = 'tenant-cashflow-edit-drafts';
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const timestamp = '2026-07-12T00:00:00.000Z';
  const api = request(createBffApp({
    projectId: firebaseProjectId,
    db,
    authMode: 'headers',
    now: () => timestamp,
    projectRegistrationDraftStorageService: {},
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

  async function clearCollection(path: string) {
    const snapshot = await db.collection(path).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }

  async function reset() {
    await Promise.all([
      'members', 'projects', 'privateEditDrafts', 'editLeases',
      'audit_logs', 'audit_chain', 'idempotency_keys',
    ].map((name) => clearCollection(`orgs/${tenantId}/${name}`)));
    const batch = db.batch();
    batch.set(db.doc(`orgs/${tenantId}/members/actor-a`), {
      uid: 'actor-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    });
    batch.set(db.doc(`orgs/${tenantId}/members/actor-admin`), {
      uid: 'actor-admin', role: 'admin', status: 'ACTIVE', projectIds: [],
    });
    batch.set(db.doc(`orgs/${tenantId}/projects/project-a`), {
      id: 'project-a', tenantId, name: 'Project A', version: 1,
      registeredById: 'actor-a', managerId: 'actor-a',
    });
    await batch.commit();
  }

  beforeEach(reset, 60_000);
  afterAll(reset, 60_000);

  it('mounts the Stage route and keeps an opened cashflow snapshot private to its owner', async () => {
    const acquired = await api
      .post('/api/v1/edit-leases/cashflow/project-a/acquire')
      .set({
        ...actorHeaders(),
        'x-edit-session-id': 'session-a',
        'idempotency-key': 'cashflow-lease-acquire-a',
      })
      .send({});
    expect(acquired.status).toBe(200);

    const opened = await api
      .post('/api/v1/cashflow-edit-drafts/project-a/open')
      .set({
        ...actorHeaders(),
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': acquired.body.leaseId,
        'x-edit-fence': String(acquired.body.fence),
        'idempotency-key': 'cashflow-draft-open-a',
      })
      .send({
        baseSnapshot: { weeklySheet: [{ id: 'row-a', amount: 100 }] },
        payload: { weeklySheet: [{ id: 'row-a', amount: 120 }] },
      });

    expect(opened.status).toBe(200);
    expect(opened.body.draft).toMatchObject({
      projectId: 'project-a', status: 'ACTIVE', draftRevision: 0,
      payload: { weeklySheet: [{ id: 'row-a', amount: 120 }] },
    });
    const privateDrafts = await db.collection(`orgs/${tenantId}/privateEditDrafts`).get();
    expect(privateDrafts.size).toBe(1);
    expect(privateDrafts.docs[0].data()).toMatchObject({
      ownerUid: 'actor-a', resourceType: 'cashflow', resourceId: 'project-a',
    });

    const otherActorRead = await api
      .get('/api/v1/cashflow-edit-drafts/project-a')
      .set(actorHeaders('actor-admin', 'admin'));
    expect(otherActorRead.status).toBe(404);
  });
});
