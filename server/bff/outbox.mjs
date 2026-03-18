import { randomUUID } from 'node:crypto';
import { createNotificationsForOutboxEvent } from './notifications.mjs';

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

async function claimEvent(db, ref, nowIso) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const event = snap.data() || {};
    if (!['PENDING', 'FAILED'].includes(event.status)) return null;
    if (typeof event.nextAttemptAt === 'string' && event.nextAttemptAt > nowIso) return null;

    const nextAttempts = parseAttempts(event.attempts) + 1;
    tx.update(ref, {
      status: 'PROCESSING',
      attempts: nextAttempts,
      processingStartedAt: nowIso,
      updatedAt: nowIso,
    });

    return {
      ...event,
      id: snap.id,
      attempts: nextAttempts,
    };
  });
}

async function defaultOutboxHandler(db, event, nowIso) {
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

async function markSuccess(ref, nowIso) {
  await ref.set({
    status: 'DONE',
    processedAt: nowIso,
    updatedAt: nowIso,
    lastError: null,
  }, { merge: true });
}

async function markFailure(ref, event, nowIso, maxAttempts, error) {
  const attempts = parseAttempts(event.attempts);
  const isDead = attempts >= maxAttempts;
  const delaySeconds = computeRetryDelaySeconds(attempts);
  const nextAttemptAt = new Date(new Date(nowIso).getTime() + (delaySeconds * 1000)).toISOString();

  await ref.set({
    status: isDead ? 'DEAD' : 'FAILED',
    updatedAt: nowIso,
    nextAttemptAt,
    lastError: {
      message: error instanceof Error ? error.message : String(error),
      at: nowIso,
    },
  }, { merge: true });
}

export async function processOutboxBatch(db, {
  limit = 50,
  maxAttempts = 8,
  now = () => new Date().toISOString(),
  handler,
} = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 50, 1), 500);
  const nowIso = toIso(now());
  const outboxHandler = handler || ((event) => defaultOutboxHandler(db, event, nowIso));

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

  const seen = new Set();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const doc of dueDocs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);

    const ref = db.doc(`outbox/${doc.id}`);
    const claimed = await claimEvent(db, ref, nowIso);
    if (!claimed) continue;

    processed += 1;
    try {
      await outboxHandler(claimed);
      await markSuccess(ref, nowIso);
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
    scanned: dueDocs.length,
    at: nowIso,
  };
}
