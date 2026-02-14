#!/usr/bin/env node
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';
import { createPiiProtector } from '../server/bff/pii-protection.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID || resolveProjectId();
const batchSize = Math.min(Math.max(Number.parseInt(process.env.PII_ROTATE_BATCH || '200', 10) || 200, 20), 500);
const dryRun = String(process.env.PII_ROTATE_DRY_RUN || 'false').toLowerCase() === 'true';

const pii = createPiiProtector();
if (!pii.enabled) {
  console.log('[pii-rotate] skipped: PII protection is disabled (PII_MODE/off or missing keys)');
  process.exit(0);
}

const db = createFirestoreDb({ projectId });

const targets = [
  { collectionGroup: 'comments', field: 'authorNameEnc' },
  { collectionGroup: 'audit_logs', field: 'userEmailEnc' },
];

async function rotateCollectionField(target) {
  let scanned = 0;
  let rotated = 0;
  let cursor = null;

  for (;;) {
    let query = db.collectionGroup(target.collectionGroup).orderBy('__name__').limit(batchSize);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let updatesInBatch = 0;

    for (const doc of snap.docs) {
      scanned += 1;
      const current = doc.data()?.[target.field];
      if (typeof current !== 'string' || !current) continue;
      if (!pii.needsRotation(current)) continue;

      const next = await pii.rotateCiphertext(current);
      if (!next.changed) continue;

      rotated += 1;
      updatesInBatch += 1;
      if (!dryRun) {
        batch.update(doc.ref, {
          [target.field]: next.ciphertext,
          piiRotatedAt: new Date().toISOString(),
        });
      }
    }

    if (!dryRun && updatesInBatch > 0) {
      await batch.commit();
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < batchSize) break;
  }

  return { scanned, rotated };
}

let totalScanned = 0;
let totalRotated = 0;
for (const target of targets) {
  const result = await rotateCollectionField(target);
  totalScanned += result.scanned;
  totalRotated += result.rotated;
  console.log(`[pii-rotate] ${target.collectionGroup}.${target.field} scanned=${result.scanned} rotated=${result.rotated}`);
}

console.log(`[pii-rotate] done project=${projectId} dryRun=${dryRun} scanned=${totalScanned} rotated=${totalRotated}`);
