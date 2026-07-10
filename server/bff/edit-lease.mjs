import { randomUUID } from 'node:crypto';
import { createHttpError, readOptionalText } from './bff-utils.mjs';

export const EDIT_LEASE_TTL_MS = 1_800_000;

const RESOURCE_TYPES = new Set(['project-registration', 'project-info', 'cashflow']);

function editLeaseError(statusCode, message, code, publicDetails, auditContext) {
  const error = createHttpError(statusCode, message, code);
  if (publicDetails) {
    error.publicDetails = publicDetails;
    error.details = publicDetails;
  }
  if (auditContext) error.auditContext = auditContext;
  return error;
}

function requiredText(value, fieldName) {
  const normalized = readOptionalText(value);
  if (!normalized) {
    throw editLeaseError(400, `${fieldName} is required`, 'edit_lease_request_invalid');
  }
  return normalized;
}

function normalizeResource(resourceType, resourceId) {
  const normalizedType = readOptionalText(resourceType);
  const normalizedId = readOptionalText(resourceId);
  if (!RESOURCE_TYPES.has(normalizedType) || !normalizedId) {
    throw editLeaseError(400, 'Unsupported edit lease resource', 'edit_lease_resource_invalid');
  }
  return { resourceType: normalizedType, resourceId: normalizedId };
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(String(value || ''));
}

function serverNow(clock) {
  const value = toMillis(clock());
  if (!Number.isFinite(value)) throw new Error('Edit lease clock returned an invalid time');
  return value;
}

function asIso(value) {
  return new Date(value).toISOString();
}

function activeAt(lease, nowMs) {
  const expiresAt = toMillis(lease?.expiresAt);
  return lease?.state === 'ACTIVE' && Number.isFinite(expiresAt) && nowMs < expiresAt;
}

function nextFence(lease) {
  const current = Number(lease?.fence);
  return Number.isSafeInteger(current) && current > 0 ? current + 1 : 1;
}

function auditFence(lease) {
  const fence = Number(lease?.fence);
  return Number.isSafeInteger(fence) && fence > 0 ? fence : null;
}

function heldDetails(lease, actorId) {
  return {
    holderDisplayName: readOptionalText(lease?.holderDisplayName) || '다른 사용자',
    sameActor: readOptionalText(lease?.holderUid) === actorId,
    expiresAt: lease?.expiresAt || null,
  };
}

function ownedStatus(lease, nowMs) {
  return {
    serverNow: asIso(nowMs),
    state: 'ACTIVE',
    canEdit: true,
    expiresAt: lease.expiresAt,
    leaseId: lease.leaseId,
    fence: lease.fence,
  };
}

function leaseRefFor(db, tenantId, resourceType, resourceId) {
  return db.doc(`orgs/${tenantId}/editLeases/${resolveEditLeaseDocumentId(resourceType, resourceId)}`);
}

export function resolveEditLeaseDocumentId(resourceType, resourceId) {
  const resource = normalizeResource(resourceType, resourceId);
  return `v1_${Buffer.from(JSON.stringify([resource.resourceType, resource.resourceId]), 'utf8').toString('base64url')}`;
}

export async function assertOwnedInTransaction({
  tx,
  db,
  leaseRef,
  tenantId,
  resourceType,
  resourceId,
  actorId,
  sessionId,
  leaseId,
  fence,
  serverNow: nowValue,
}) {
  const resource = normalizeResource(resourceType, resourceId);
  const normalizedTenantId = requiredText(tenantId, 'tenantId');
  const normalizedActorId = requiredText(actorId, 'actorId');
  const normalizedSessionId = requiredText(sessionId, 'sessionId');
  const normalizedLeaseId = requiredText(leaseId, 'leaseId');
  const normalizedFence = Number(fence);
  if (!Number.isSafeInteger(normalizedFence) || normalizedFence < 1) {
    throw editLeaseError(400, 'fence must be a positive integer', 'edit_lease_request_invalid');
  }

  const nowMs = toMillis(nowValue);
  if (!Number.isFinite(nowMs)) throw new Error('Edit lease serverNow is invalid');
  const ref = leaseRef || leaseRefFor(db, normalizedTenantId, resource.resourceType, resource.resourceId);
  const snap = await tx.get(ref);
  if (!snap.exists) {
    throw editLeaseError(410, 'The edit lease has expired', 'edit_lease_expired', undefined, {
      serverNow: asIso(nowMs),
      fence: null,
    });
  }

  const lease = snap.data() || {};
  if (!activeAt(lease, nowMs)) {
    throw editLeaseError(410, 'The edit lease has expired', 'edit_lease_expired', undefined, {
      serverNow: asIso(nowMs),
      fence: auditFence(lease),
    });
  }

  if (
    readOptionalText(lease.tenantId) !== normalizedTenantId
    || readOptionalText(lease.resourceType) !== resource.resourceType
    || readOptionalText(lease.resourceId) !== resource.resourceId
    || readOptionalText(lease.holderUid) !== normalizedActorId
    || readOptionalText(lease.sessionId) !== normalizedSessionId
    || readOptionalText(lease.leaseId) !== normalizedLeaseId
    || Number(lease.fence) !== normalizedFence
  ) {
    throw editLeaseError(423, 'The edit lease is held by another session', 'edit_lease_held', undefined, {
      serverNow: asIso(nowMs),
      fence: auditFence(lease),
    });
  }

  return lease;
}

export function createEditLeaseService({ db, now = () => Date.now(), createLeaseId = randomUUID } = {}) {
  if (!db || typeof db.runTransaction !== 'function') {
    throw new Error('Firestore is required for edit leases');
  }

  function context(input) {
    const resource = normalizeResource(input?.resourceType, input?.resourceId);
    const tenantId = requiredText(input?.tenantId, 'tenantId');
    const actorId = requiredText(input?.actorId, 'actorId');
    const sessionId = requiredText(input?.sessionId, 'sessionId');
    return {
      ...resource,
      tenantId,
      actorId,
      sessionId,
      actorDisplayName: readOptionalText(input?.actorDisplayName) || '사용자',
      leaseRef: leaseRefFor(db, tenantId, resource.resourceType, resource.resourceId),
    };
  }

  return {
    async getStatus(input) {
      const current = context(input);
      const nowMs = serverNow(now);
      const snap = await current.leaseRef.get();
      if (!snap.exists) {
        return { serverNow: asIso(nowMs), state: 'AVAILABLE', canEdit: false, expiresAt: null };
      }

      const lease = snap.data() || {};
      if (lease.state === 'RELEASED') {
        return { serverNow: asIso(nowMs), state: 'RELEASED', canEdit: false, expiresAt: lease.expiresAt || null };
      }
      if (!activeAt(lease, nowMs)) {
        return {
          serverNow: asIso(nowMs),
          state: 'EXPIRED',
          canEdit: false,
          expiresAt: lease.expiresAt || null,
          audit: { fence: auditFence(lease) },
        };
      }
      if (lease.holderUid === current.actorId && lease.sessionId === current.sessionId) {
        return ownedStatus(lease, nowMs);
      }
      return {
        serverNow: asIso(nowMs),
        state: 'ACTIVE',
        canEdit: false,
        expiresAt: lease.expiresAt,
        holderDisplayName: readOptionalText(lease.holderDisplayName) || '다른 사용자',
        sameActor: lease.holderUid === current.actorId,
      };
    },

    async acquire(input) {
      const current = context(input);
      return db.runTransaction(async (tx) => {
        const nowMs = serverNow(now);
        const snap = await tx.get(current.leaseRef);
        const existing = snap.exists ? (snap.data() || {}) : null;
        if (activeAt(existing, nowMs)) {
          if (existing.holderUid === current.actorId && existing.sessionId === current.sessionId) {
            return ownedStatus(existing, nowMs);
          }
          throw editLeaseError(
            423,
            'The edit lease is held by another session',
            'edit_lease_held',
            heldDetails(existing, current.actorId),
            { serverNow: asIso(nowMs), fence: auditFence(existing) },
          );
        }

        const leaseId = requiredText(createLeaseId(), 'leaseId');
        const timestamp = asIso(nowMs);
        const lease = {
          tenantId: current.tenantId,
          resourceType: current.resourceType,
          resourceId: current.resourceId,
          holderUid: current.actorId,
          holderDisplayName: current.actorDisplayName,
          sessionId: current.sessionId,
          leaseId,
          fence: nextFence(existing),
          state: 'ACTIVE',
          acquiredAt: timestamp,
          expiresAt: asIso(nowMs + EDIT_LEASE_TTL_MS),
          updatedAt: timestamp,
        };
        tx.set(current.leaseRef, lease);
        return ownedStatus(lease, nowMs);
      });
    },

    async extend(input) {
      const current = context(input);
      return db.runTransaction(async (tx) => {
        const nowMs = serverNow(now);
        const lease = await assertOwnedInTransaction({
          tx,
          leaseRef: current.leaseRef,
          ...current,
          leaseId: input?.leaseId,
          fence: input?.fence,
          serverNow: nowMs,
        });
        const extended = {
          ...lease,
          expiresAt: asIso(nowMs + EDIT_LEASE_TTL_MS),
          updatedAt: asIso(nowMs),
        };
        tx.set(current.leaseRef, extended);
        return ownedStatus(extended, nowMs);
      });
    },

    async release(input) {
      const current = context(input);
      return db.runTransaction(async (tx) => {
        const nowMs = serverNow(now);
        const lease = await assertOwnedInTransaction({
          tx,
          leaseRef: current.leaseRef,
          ...current,
          leaseId: input?.leaseId,
          fence: input?.fence,
          serverNow: nowMs,
        });
        const released = { ...lease, state: 'RELEASED', updatedAt: asIso(nowMs) };
        tx.set(current.leaseRef, released);
        return {
          serverNow: asIso(nowMs),
          state: 'RELEASED',
          canEdit: false,
          expiresAt: released.expiresAt,
        };
      });
    },
  };
}
