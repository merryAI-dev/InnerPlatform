export async function cleanupExpiredIdempotencyKeys(db, {
  nowIso = new Date().toISOString(),
  batchSize = 200,
  dryRun = false,
} = {}) {
  let deleted = 0;

  for (;;) {
    const snap = await db
      .collectionGroup('idempotency_keys')
      .where('expiresAt', '<=', nowIso)
      .limit(batchSize)
      .get();

    if (snap.empty) break;

    if (dryRun) {
      deleted += snap.size;
      break;
    }

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < batchSize) break;
  }

  return { deleted, nowIso, dryRun };
}
