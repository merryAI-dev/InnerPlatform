import { createFirestoreDb, resolveProjectId } from './firestore.mjs';
import { processOutboxBatch } from './outbox.mjs';

const projectId = resolveProjectId();
const db = createFirestoreDb({ projectId });

const batchSize = Number.parseInt(process.env.BFF_OUTBOX_BATCH || '50', 10);
const maxAttempts = Number.parseInt(process.env.BFF_OUTBOX_MAX_ATTEMPTS || '8', 10);
const loop = String(process.env.BFF_OUTBOX_LOOP || 'false').toLowerCase() === 'true';
const intervalMs = Number.parseInt(process.env.BFF_OUTBOX_INTERVAL_MS || '5000', 10);

async function runOnce() {
  const result = await processOutboxBatch(db, {
    limit: batchSize,
    maxAttempts,
  });
  // eslint-disable-next-line no-console
  console.log(`[bff-outbox] project=${projectId} processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} dead=${result.dead}`);
  return result;
}

if (!loop) {
  await runOnce();
  process.exit(0);
}

for (;;) {
  try {
    await runOnce();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[bff-outbox] worker error:', error instanceof Error ? error.message : String(error));
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(1000, intervalMs)));
}
