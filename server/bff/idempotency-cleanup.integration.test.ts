import { beforeEach, describe, expect, it } from 'vitest';
import { createFirestoreDb } from './firestore.mjs';
import { cleanupExpiredIdempotencyKeys } from './idempotency-cleanup.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('idempotency cleanup (Firestore emulator)', () => {
  const projectId = 'demo-bff-it';
  const db = createFirestoreDb({ projectId });

  async function clearTenant(tenantId: string) {
    const snap = await db.collection(`orgs/${tenantId}/idempotency_keys`).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  beforeEach(async () => {
    await clearTenant('tenant-a');
    await clearTenant('tenant-b');
  });

  it('deletes only expired documents', async () => {
    await db.doc('orgs/tenant-a/idempotency_keys/expired').set({ expiresAt: '2026-01-01T00:00:00.000Z' });
    await db.doc('orgs/tenant-a/idempotency_keys/future').set({ expiresAt: '2027-01-01T00:00:00.000Z' });
    await db.doc('orgs/tenant-b/idempotency_keys/expired').set({ expiresAt: '2026-01-01T00:00:00.000Z' });

    const result = await cleanupExpiredIdempotencyKeys(db, {
      nowIso: '2026-06-01T00:00:00.000Z',
      batchSize: 10,
      dryRun: false,
    });

    expect(result.deleted).toBe(2);

    const tenantASnap = await db.collection('orgs/tenant-a/idempotency_keys').get();
    const tenantBSnap = await db.collection('orgs/tenant-b/idempotency_keys').get();

    expect(tenantASnap.docs.map((doc) => doc.id)).toEqual(['future']);
    expect(tenantBSnap.empty).toBe(true);
  });
});
