import { createFirestoreDb, resolveProjectId } from './firestore.mjs';
import { processWorkQueueBatch } from './work-queue.mjs';

const projectId = resolveProjectId();
const db = createFirestoreDb({ projectId });

const batchSize = Number.parseInt(process.env.BFF_WORK_QUEUE_BATCH || '100', 10);
const maxAttempts = Number.parseInt(process.env.BFF_WORK_QUEUE_MAX_ATTEMPTS || '6', 10);
const loop = String(process.env.BFF_WORK_QUEUE_LOOP || 'false').toLowerCase() === 'true';
const intervalMs = Number.parseInt(process.env.BFF_WORK_QUEUE_INTERVAL_MS || '3000', 10);

async function runOnce() {
  const result = await processWorkQueueBatch(db, {
    limit: batchSize,
    maxAttempts,
  });
  // eslint-disable-next-line no-console
  console.log(`[bff-work-queue] project=${projectId} processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} dead=${result.dead}`);
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
    console.error('[bff-work-queue] worker error:', error instanceof Error ? error.message : String(error));
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(1000, intervalMs)));
}
