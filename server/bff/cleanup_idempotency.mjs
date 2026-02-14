import { createFirestoreDb, resolveProjectId } from './firestore.mjs';
import { cleanupExpiredIdempotencyKeys } from './idempotency-cleanup.mjs';

const projectId = resolveProjectId();
const batchSize = Number.parseInt(process.env.BFF_IDEMPOTENCY_CLEANUP_BATCH || '200', 10);
const nowIso = new Date().toISOString();
const dryRun = String(process.env.BFF_IDEMPOTENCY_CLEANUP_DRY_RUN || 'false').toLowerCase() === 'true';

const db = createFirestoreDb({ projectId });

const result = await cleanupExpiredIdempotencyKeys(db, {
  nowIso,
  batchSize,
  dryRun,
});

console.log(
  `[bff-idempotency-cleanup] project=${projectId} dryRun=${result.dryRun} deleted=${result.deleted} cutoff=${result.nowIso}`,
);
