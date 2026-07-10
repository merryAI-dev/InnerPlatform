import { randomUUID } from 'node:crypto';
import { createNotificationsForOutboxEvent } from './notifications.mjs';

const HANDLER_REQUIRED_EVENT_TYPES = new Set(['project.registration.submitted']);
const DEFAULT_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

function toIso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseAttempts(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function buildOutboxId(timestampIso = new Date().toISOString()) {
  const ts = new Date(timestampIso).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `ob_${ts}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

function computeRetryDelaySeconds(nextAttempt) {
  return Math.min(300, Math.pow(2, Math.min(nextAttempt, 8)));
}

function isAlreadyExistsError(error) {
  return !!(error && (error.code === 6 || /already exists/i.test(error.message || '')));
}

function validTime(value) {
  const timestamp = Date.parse(typeof value === 'string' ? value : '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isStaleProcessing(event, nowMs, processingTimeoutMs) {
  const expiresAt = validTime(event?.processingLeaseExpiresAt);
  if (expiresAt !== null) return expiresAt <= nowMs;
  const startedAt = validTime(event?.processingStartedAt);
  return startedAt !== null && startedAt + processingTimeoutMs <= nowMs;
}

export function createOutboxEvent({
  tenantId,
  requestId,
  eventType,
  entityType,
  entityId,
  payload,
  createdAt = new Date().toISOString(),
}) {
  const timestamp = toIso(createdAt);
  return {
    id: buildOutboxId(timestamp),
    tenantId,
    requestId,
    eventType,
    entityType,
    entityId,
    payload: payload || {},
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function enqueueOutboxEvent(db, event) {
  await db.doc(`outbox/${event.id}`).create(event);
  return event;
}

export function enqueueOutboxEventInTransaction(tx, db, event) {
  tx.create(db.doc(`outbox/${event.id}`), event);
}

async function claimEvent(db, ref, nowIso, {
  workerId,
  processingTimeoutMs,
  createClaimToken,
}) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const event = snap.data() || {};
    const processing = event.status === 'PROCESSING';
    if (!processing && !['PENDING', 'FAILED'].includes(event.status)) return null;
    if (processing) {
      if (!isStaleProcessing(event, Date.parse(nowIso), processingTimeoutMs)) return null;
    } else if (typeof event.nextAttemptAt === 'string' && event.nextAttemptAt > nowIso) {
      return null;
    }

    const nextAttempts = parseAttempts(event.attempts) + 1;
    const claimToken = createClaimToken();
    const processingLeaseExpiresAt = new Date(Date.parse(nowIso) + processingTimeoutMs).toISOString();
    tx.update(ref, {
      status: 'PROCESSING',
      attempts: nextAttempts,
      claimOwner: workerId,
      claimToken,
      processingStartedAt: nowIso,
      processingLeaseExpiresAt,
      updatedAt: nowIso,
    });

    return {
      ...event,
      id: snap.id,
      attempts: nextAttempts,
      status: 'PROCESSING',
      claimOwner: workerId,
      claimToken,
      processingStartedAt: nowIso,
      processingLeaseExpiresAt,
    };
  });
}

async function defaultOutboxHandler(db, event, nowIso, eventHandlers) {
  const eventHandler = eventHandlers?.[event.eventType];
  if (HANDLER_REQUIRED_EVENT_TYPES.has(event.eventType) && typeof eventHandler !== 'function') {
    throw new Error(`Outbox handler is not configured for ${event.eventType}`);
  }
  if (typeof eventHandler === 'function') await eventHandler(event);

  const ref = db.doc(`orgs/${event.tenantId}/outbox_deliveries/${event.id}`);
  try {
    await ref.create({
      id: event.id,
      tenantId: event.tenantId,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload || {},
      requestId: event.requestId || null,
      deliveredAt: nowIso,
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  await createNotificationsForOutboxEvent(db, event, nowIso);
}

async function markSuccess(db, ref, event, nowIso) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() || {}) : {};
    if (current.status !== 'PROCESSING' || current.claimToken !== event.claimToken) return false;
    tx.set(ref, {
      status: 'DONE',
      processedAt: nowIso,
      updatedAt: nowIso,
      lastError: null,
      claimOwner: null,
      claimToken: null,
      processingLeaseExpiresAt: null,
    }, { merge: true });
    return true;
  });
}

async function markFailure(db, ref, event, nowIso, maxAttempts, error) {
  const attempts = parseAttempts(event.attempts);
  const isDead = attempts >= maxAttempts;
  const delaySeconds = computeRetryDelaySeconds(attempts);
  const nextAttemptAt = new Date(new Date(nowIso).getTime() + (delaySeconds * 1000)).toISOString();

  const updated = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() || {}) : {};
    if (current.status !== 'PROCESSING' || current.claimToken !== event.claimToken) return false;
    tx.set(ref, {
      status: isDead ? 'DEAD' : 'FAILED',
      updatedAt: nowIso,
      nextAttemptAt,
      claimOwner: null,
      claimToken: null,
      processingLeaseExpiresAt: null,
      lastError: {
        message: error instanceof Error ? error.message : String(error),
        at: nowIso,
      },
    }, { merge: true });
    return true;
  });
  return { updated, isDead };
}

export async function processOutboxBatch(db, {
  limit = 50,
  maxAttempts = 8,
  now = () => new Date().toISOString(),
  handler,
  eventHandlers,
  workerId = `worker-${randomUUID()}`,
  processingTimeoutMs = DEFAULT_PROCESSING_TIMEOUT_MS,
  createClaimToken = randomUUID,
} = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 50, 1), 500);
  const nowIso = toIso(now());
  const safeProcessingTimeoutMs = Number.isFinite(processingTimeoutMs) && processingTimeoutMs > 0
    ? processingTimeoutMs
    : DEFAULT_PROCESSING_TIMEOUT_MS;
  const outboxHandler = handler || ((event) => defaultOutboxHandler(db, event, nowIso, eventHandlers));

  const dueDocs = [];
  for (const status of ['PENDING', 'FAILED']) {
    const snap = await db
      .collection('outbox')
      .where('status', '==', status)
      .where('nextAttemptAt', '<=', nowIso)
      .orderBy('nextAttemptAt', 'asc')
      .limit(safeLimit)
      .get();
    dueDocs.push(...snap.docs);
  }
  const processingSnap = await db
    .collection('outbox')
    .where('status', '==', 'PROCESSING')
    .limit(safeLimit)
    .get();
  dueDocs.push(...processingSnap.docs.filter((doc) => isStaleProcessing(
    doc.data() || {},
    Date.parse(nowIso),
    safeProcessingTimeoutMs,
  )));

  const seen = new Set();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const doc of dueDocs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);

    const ref = db.doc(`outbox/${doc.id}`);
    const claimed = await claimEvent(db, ref, nowIso, {
      workerId,
      processingTimeoutMs: safeProcessingTimeoutMs,
      createClaimToken,
    });
    if (!claimed) continue;

    processed += 1;
    try {
      await outboxHandler(claimed);
      if (await markSuccess(db, ref, claimed, nowIso)) succeeded += 1;
    } catch (error) {
      const outcome = await markFailure(db, ref, claimed, nowIso, maxAttempts, error);
      if (outcome.updated) {
        failed += 1;
        if (outcome.isDead) dead += 1;
      }
    }
  }

  return {
    processed,
    succeeded,
    failed,
    dead,
    scanned: dueDocs.length,
    at: nowIso,
  };
}
