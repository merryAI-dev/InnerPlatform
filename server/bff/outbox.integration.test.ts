import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFirestoreDb } from './firestore.mjs';
import { createOutboxEvent, enqueueOutboxEvent, processOutboxBatch } from './outbox.mjs';
import { buildNotificationId } from './notifications.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('outbox worker integration (Firestore emulator)', () => {
  const projectId = 'demo-bff-outbox-it';
  const tenantId = 'mysc';
  const db = createFirestoreDb({ projectId });

  async function clearCollection(path: string): Promise<void> {
    const snap = await db.collection(path).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  async function resetData(): Promise<void> {
    await clearCollection('outbox');
    await clearCollection(`orgs/${tenantId}/transactions`);
    await clearCollection(`orgs/${tenantId}/members`);
    await clearCollection(`orgs/${tenantId}/outbox_deliveries`);
    await clearCollection(`orgs/${tenantId}/notifications`);
  }

  beforeAll(async () => {
    await resetData();
  });

  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await resetData();
  });

  it('processes pending events and writes delivery records', async () => {
    const event = createOutboxEvent({
      tenantId,
      requestId: 'req-outbox-001',
      eventType: 'transaction.upsert',
      entityType: 'transaction',
      entityId: 'tx001',
      payload: { amount: 1000 },
      createdAt: new Date().toISOString(),
    });
    event.nextAttemptAt = new Date(0).toISOString();

    await enqueueOutboxEvent(db, event);
    const result = await processOutboxBatch(db, { limit: 20, maxAttempts: 3 });

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);

    const outboxSnap = await db.doc(`outbox/${event.id}`).get();
    expect(outboxSnap.data()?.status).toBe('DONE');

    const deliverySnap = await db.doc(`orgs/${tenantId}/outbox_deliveries/${event.id}`).get();
    expect(deliverySnap.exists).toBe(true);
  });

  it('creates notifications when transaction is submitted', async () => {
    await db.doc(`orgs/${tenantId}/members/admin1`).set({ uid: 'admin1', role: 'admin', tenantId });
    await db.doc(`orgs/${tenantId}/members/fin1`).set({ uid: 'fin1', role: 'finance', tenantId });
    await db.doc(`orgs/${tenantId}/transactions/tx100`).set({
      id: 'tx100',
      tenantId,
      projectId: 'p1',
      ledgerId: 'l1',
      counterparty: '거래처A',
      amounts: { bankAmount: 1000 },
      state: 'SUBMITTED',
      submittedBy: 'pm1',
      updatedAt: new Date().toISOString(),
    });

    const event = createOutboxEvent({
      tenantId,
      requestId: 'req-outbox-003',
      eventType: 'transaction.state_changed',
      entityType: 'transaction',
      entityId: 'tx100',
      payload: { nextState: 'SUBMITTED', actorId: 'pm1', actorRole: 'pm' },
      createdAt: new Date().toISOString(),
    });
    event.nextAttemptAt = new Date(0).toISOString();

    await enqueueOutboxEvent(db, event);
    const result = await processOutboxBatch(db, { limit: 20, maxAttempts: 3 });
    expect(result.succeeded).toBe(1);

    const adminNotifId = buildNotificationId({ eventId: event.id, recipientId: 'admin1' });
    const finNotifId = buildNotificationId({ eventId: event.id, recipientId: 'fin1' });

    const adminSnap = await db.doc(`orgs/${tenantId}/notifications/${adminNotifId}`).get();
    const finSnap = await db.doc(`orgs/${tenantId}/notifications/${finNotifId}`).get();
    expect(adminSnap.exists).toBe(true);
    expect(finSnap.exists).toBe(true);
  });

  it('creates notification for submitter when transaction is approved', async () => {
    await db.doc(`orgs/${tenantId}/members/pm1`).set({ uid: 'pm1', role: 'pm', tenantId });
    await db.doc(`orgs/${tenantId}/transactions/tx200`).set({
      id: 'tx200',
      tenantId,
      projectId: 'p1',
      ledgerId: 'l1',
      counterparty: '거래처B',
      amounts: { bankAmount: 2500 },
      state: 'APPROVED',
      submittedBy: 'pm1',
      approvedBy: 'admin1',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const event = createOutboxEvent({
      tenantId,
      requestId: 'req-outbox-004',
      eventType: 'transaction.state_changed',
      entityType: 'transaction',
      entityId: 'tx200',
      payload: { nextState: 'APPROVED', actorId: 'admin1', actorRole: 'admin' },
      createdAt: new Date().toISOString(),
    });
    event.nextAttemptAt = new Date(0).toISOString();

    await enqueueOutboxEvent(db, event);
    const result = await processOutboxBatch(db, { limit: 20, maxAttempts: 3 });
    expect(result.succeeded).toBe(1);

    const notifId = buildNotificationId({ eventId: event.id, recipientId: 'pm1' });
    const snap = await db.doc(`orgs/${tenantId}/notifications/${notifId}`).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.state).toBe('APPROVED');
  });

  it('retries failed events and marks DEAD when attempts exceed max', async () => {
    const event = createOutboxEvent({
      tenantId,
      requestId: 'req-outbox-002',
      eventType: 'transaction.upsert',
      entityType: 'transaction',
      entityId: 'tx002',
      payload: {},
      createdAt: new Date().toISOString(),
    });
    event.nextAttemptAt = new Date(0).toISOString();

    await enqueueOutboxEvent(db, event);

    const failHandler = async () => {
      throw new Error('temporary downstream failure');
    };

    const first = await processOutboxBatch(db, { limit: 20, maxAttempts: 2, handler: failHandler });
    expect(first.failed).toBe(1);

    await db.doc(`outbox/${event.id}`).set({ nextAttemptAt: new Date(0).toISOString() }, { merge: true });
    const second = await processOutboxBatch(db, { limit: 20, maxAttempts: 2, handler: failHandler });
    expect(second.failed).toBe(1);

    const snap = await db.doc(`outbox/${event.id}`).get();
    expect(snap.data()?.status).toBe('DEAD');
  });
});
