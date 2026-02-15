import { createHash, randomUUID } from 'node:crypto';
import { rebuildView } from './projections.mjs';

function toIso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toAttempts(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function retryDelaySeconds(nextAttempt) {
  return Math.min(300, Math.pow(2, Math.min(nextAttempt, 8)));
}

function isAlreadyExistsError(error) {
  return !!(error && (error.code === 6 || /already exists/i.test(error.message || '')));
}

function buildQueueHash(input) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, 16);
}

function buildJobId({ eventId, viewName, dedupeKey, nonce = '' }) {
  const hash = buildQueueHash(`${eventId}|${viewName}|${dedupeKey}|${nonce}`);
  return `wq_${hash}`;
}

export function createWorkQueueJob({
  tenantId,
  eventId,
  entityType,
  entityId,
  viewName,
  dedupeKey,
  payload,
  createdAt = new Date().toISOString(),
  nonce,
}) {
  const nowIso = toIso(createdAt);
  const resolvedDedupeKey = String(dedupeKey || `${tenantId}:${viewName}:${entityType}:${entityId}`);
  return {
    id: buildJobId({ eventId, viewName, dedupeKey: resolvedDedupeKey, nonce }),
    tenantId,
    eventId,
    entityType,
    entityId,
    viewName,
    dedupeKey: resolvedDedupeKey,
    payload: payload || {},
    status: 'READY',
    attempts: 0,
    nextAttemptAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function enqueueWorkQueueJobsInTransaction(tx, db, jobs) {
  for (const job of jobs || []) {
    tx.set(db.doc(`work_queue/${job.id}`), job, { merge: true });
  }
}

async function claimJob(db, ref, nowIso) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const job = snap.data() || {};
    if (!['READY', 'FAILED'].includes(job.status)) return null;
    if (typeof job.nextAttemptAt === 'string' && job.nextAttemptAt > nowIso) return null;

    const attempts = toAttempts(job.attempts) + 1;
    tx.update(ref, {
      status: 'PROCESSING',
      attempts,
      processingStartedAt: nowIso,
      updatedAt: nowIso,
    });
    return {
      ...job,
      id: snap.id,
      attempts,
    };
  });
}

async function markSuccess(ref, nowIso, resultPayload) {
  await ref.set({
    status: 'DONE',
    processedAt: nowIso,
    updatedAt: nowIso,
    lastError: null,
    lastResult: resultPayload || null,
  }, { merge: true });
}

async function markFailure(ref, job, nowIso, maxAttempts, error) {
  const attempts = toAttempts(job.attempts);
  const isDead = attempts >= maxAttempts;
  const nextAttemptAt = new Date(new Date(nowIso).getTime() + retryDelaySeconds(attempts) * 1000).toISOString();
  await ref.set({
    status: isDead ? 'DEAD' : 'FAILED',
    nextAttemptAt,
    updatedAt: nowIso,
    lastError: {
      message: error instanceof Error ? error.message : String(error),
      at: nowIso,
    },
  }, { merge: true });
}

async function defaultQueueHandler(db, job, nowIso) {
  const result = await rebuildView(db, job.tenantId, job.viewName, nowIso);
  return {
    view: job.viewName,
    updatedAt: nowIso,
    totalItems: Array.isArray(result?.items) ? result.items.length : undefined,
  };
}

export async function processWorkQueueBatch(db, {
  limit = 50,
  maxAttempts = 8,
  now = () => new Date().toISOString(),
  tenantId,
  eventId,
  handler,
} = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 50, 1), 500);
  const nowIso = toIso(now());
  const queueHandler = handler || ((job) => defaultQueueHandler(db, job, nowIso));

  // Avoid composite-index dependency by reading a bounded set then filtering in memory.
  const scanLimit = Math.max(100, safeLimit * 6);
  const snap = await db.collection('work_queue').limit(scanLimit).get();
  const due = [];

  for (const doc of snap.docs) {
    const raw = doc.data() || {};
    if (!['READY', 'FAILED'].includes(raw.status)) continue;
    if (typeof raw.nextAttemptAt === 'string' && raw.nextAttemptAt > nowIso) continue;
    if (tenantId && raw.tenantId !== tenantId) continue;
    if (eventId && raw.eventId !== eventId) continue;
    due.push({ id: doc.id, ...raw });
  }

  due.sort((a, b) => String(a.nextAttemptAt || '').localeCompare(String(b.nextAttemptAt || '')));

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const jobCandidate of due.slice(0, safeLimit)) {
    const ref = db.doc(`work_queue/${jobCandidate.id}`);
    const claimed = await claimJob(db, ref, nowIso);
    if (!claimed) continue;

    processed += 1;
    try {
      const result = await queueHandler(claimed);
      await markSuccess(ref, nowIso, result);
      succeeded += 1;
    } catch (error) {
      await markFailure(ref, claimed, nowIso, maxAttempts, error);
      failed += 1;
      if (claimed.attempts >= maxAttempts) {
        dead += 1;
      }
    }
  }

  return {
    processed,
    succeeded,
    failed,
    dead,
    scanned: snap.size,
    at: nowIso,
  };
}

export async function enqueueReplayJobs(db, {
  tenantId,
  eventId,
  entityType,
  entityId,
  views,
  createdAt = new Date().toISOString(),
}) {
  const nowIso = toIso(createdAt);
  const batch = db.batch();
  const jobs = [];

  for (const viewName of views || []) {
    const nonce = `replay_${randomUUID().slice(0, 8)}`;
    const dedupeKey = `${tenantId}:${viewName}:${entityType}:${entityId}:${eventId}:${nonce}`;
    const job = createWorkQueueJob({
      tenantId,
      eventId,
      entityType,
      entityId,
      viewName,
      dedupeKey,
      payload: { replay: true },
      createdAt: nowIso,
      nonce,
    });
    jobs.push(job);
    batch.set(db.doc(`work_queue/${job.id}`), job, { merge: true });
  }

  try {
    await batch.commit();
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  return jobs;
}
