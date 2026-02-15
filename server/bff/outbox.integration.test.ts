import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFirestoreDb } from './firestore.mjs';
import { createOutboxEvent, enqueueOutboxEvent, processOutboxBatch } from './outbox.mjs';

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
    await clearCollection(`orgs/${tenantId}/outbox_deliveries`);
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
