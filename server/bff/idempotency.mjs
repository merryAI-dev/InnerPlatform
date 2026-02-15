import { buildRequestFingerprint, sha256 } from './utils.mjs';

function idempotencyDocPath(tenantId, idempotencyKey) {
  const keyHash = sha256(idempotencyKey).slice(0, 40);
  return `orgs/${tenantId}/idempotency_keys/ik_${keyHash}`;
}

function toIso(date) {
  return date.toISOString();
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + (seconds * 1000));
}

export function createIdempotencyService(db, { now = () => new Date() } = {}) {
  return {
    async begin({ tenantId, idempotencyKey, method, path, body, actorId, requestId, ttlSeconds = 600 }) {
      const ref = db.doc(idempotencyDocPath(tenantId, idempotencyKey));
      const requestFingerprint = buildRequestFingerprint({ method, path, body });
      const nowDate = now();
      const expiresAt = addSeconds(nowDate, ttlSeconds);

      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);

        if (!snap.exists) {
          tx.set(ref, {
            tenantId,
            idempotencyKey,
            requestFingerprint,
            requestId,
            actorId,
            method: method.toUpperCase(),
            path,
            status: 'pending',
            createdAt: toIso(nowDate),
            updatedAt: toIso(nowDate),
            expiresAt: toIso(expiresAt),
          });
          return { mode: 'started', requestFingerprint };
        }

        const data = snap.data() || {};
        if (data.requestFingerprint && data.requestFingerprint !== requestFingerprint) {
          return {
            mode: 'conflict',
            reason: 'Idempotency key was already used with different payload',
          };
        }

        if (data.status === 'completed') {
          return {
            mode: 'replay',
            status: Number.isInteger(data.responseStatus) ? data.responseStatus : 200,
            body: data.responseBody ?? null,
            requestFingerprint,
          };
        }

        const pendingExpiresAt = typeof data.expiresAt === 'string' ? new Date(data.expiresAt) : null;
        if (data.status === 'pending' && pendingExpiresAt && pendingExpiresAt > nowDate) {
          return {
            mode: 'in_progress',
            reason: 'Idempotent request is still being processed',
          };
        }

        tx.update(ref, {
          requestFingerprint,
          requestId,
          actorId,
          status: 'pending',
          updatedAt: toIso(nowDate),
          expiresAt: toIso(expiresAt),
          lastError: null,
        });

        return { mode: 'started', requestFingerprint };
      });
    },

    async complete({ tenantId, idempotencyKey, requestFingerprint, responseStatus, responseBody, requestId }) {
      const ref = db.doc(idempotencyDocPath(tenantId, idempotencyKey));
      const nowDate = now();
      await ref.set({
        requestFingerprint,
        status: 'completed',
        responseStatus,
        responseBody,
        requestId,
        updatedAt: toIso(nowDate),
        completedAt: toIso(nowDate),
      }, { merge: true });
    },

    async fail({ tenantId, idempotencyKey, requestFingerprint, requestId, error }) {
      const ref = db.doc(idempotencyDocPath(tenantId, idempotencyKey));
      const nowDate = now();
      await ref.set({
        requestFingerprint,
        status: 'failed',
        requestId,
        updatedAt: toIso(nowDate),
        failedAt: toIso(nowDate),
        lastError: {
          message: error instanceof Error ? error.message : String(error),
        },
      }, { merge: true });
    },
  };
}
