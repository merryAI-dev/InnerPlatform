import { randomUUID } from 'node:crypto';
import { actorHasPermission } from './rbac-policy.mjs';
import { createHttpError, normalizeRole, readOptionalText } from './bff-utils.mjs';
import { buildRequestFingerprint, sha256 } from './utils.mjs';

export const EDIT_LEASE_TTL_MS = 1_800_000;

const RESOURCE_TYPES = new Set(['project-registration', 'project-info', 'cashflow']);
const CROSS_PROJECT_ROLES = new Set(['admin', 'finance']);
const FIRESTORE_DOCUMENT_ID_MAX_BYTES = 1_500;

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

function isInvalidOrClosedTransactionError(error) {
  if (Number(error?.code) !== 3) return false;
  return /transaction is invalid or closed/i.test(`${error?.details || ''} ${error?.message || ''}`);
}

async function runEditLeaseTransaction(db, callback) {
  try {
    return await db.runTransaction(callback);
  } catch (error) {
    if (!isInvalidOrClosedTransactionError(error)) throw error;
    return db.runTransaction(callback);
  }
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

function memberProjectIds(member = {}) {
  const profile = member.portalProfile && typeof member.portalProfile === 'object'
    ? member.portalProfile
    : {};
  return new Set([
    member.projectId,
    ...(Array.isArray(member.projectIds) ? member.projectIds : []),
    profile.projectId,
    ...(Array.isArray(profile.projectIds) ? profile.projectIds : []),
  ].map(readOptionalText).filter(Boolean));
}

function projectOwnerIds(project = {}) {
  return new Set([
    project.registeredById,
    project.managerId,
  ].map(readOptionalText).filter(Boolean));
}

export function hasEditLeaseProjectAccess({ actorRole, member, project, projectId, actorId }) {
  return CROSS_PROJECT_ROLES.has(normalizeRole(actorRole))
    || memberProjectIds(member).has(readOptionalText(projectId))
    || projectOwnerIds(project).has(readOptionalText(actorId));
}

export async function assertEditLeaseActorAccessInTransaction({
  tx,
  db,
  tenantId,
  actorId,
  rbacPolicy,
}) {
  const normalizedTenantId = requiredText(tenantId, 'tenantId');
  const normalizedActorId = requiredText(actorId, 'actorId');
  if (!rbacPolicy) throw new Error('RBAC policy is required for edit lease access');
  const memberRef = db.doc(`orgs/${normalizedTenantId}/members/${normalizedActorId}`);
  const memberSnap = await tx.get(memberRef);
  const member = memberSnap.exists ? (memberSnap.data() || {}) : {};
  const memberStatus = readOptionalText(member.status).toUpperCase();
  const memberUid = readOptionalText(member.uid);
  const actorRole = normalizeRole(member.role);
  if (
    !memberSnap.exists
    || (memberStatus && memberStatus !== 'ACTIVE')
    || (memberUid && memberUid !== normalizedActorId)
    || !actorHasPermission(rbacPolicy, { actorRole, permission: 'project:write' })
  ) {
    throw createHttpError(403, 'Project write access is required', 'forbidden');
  }
  return { actorRole, member };
}

function requiresExpiryTransition(lease, nowMs) {
  const fence = auditFence(lease);
  return lease?.state === 'ACTIVE'
    && !activeAt(lease, nowMs)
    && fence !== null
    && Number(lease?.lastExpiredFence) !== fence;
}

function commandPath(current, command) {
  return `/api/v1/edit-leases/${current.resourceType}/${current.resourceId}/${command}`;
}

function commandFingerprint(current, command, input) {
  return buildRequestFingerprint({
    method: 'POST',
    path: commandPath(current, command),
    body: {
      resourceType: current.resourceType,
      resourceId: current.resourceId,
      command,
      actorId: current.actorId,
      sessionId: current.sessionId,
      leaseId: readOptionalText(input?.leaseId) || null,
      fence: Number.isSafeInteger(Number(input?.fence)) ? Number(input.fence) : null,
    },
  });
}

export function resolveEditLeaseDocumentId(resourceType, resourceId) {
  const resource = normalizeResource(resourceType, resourceId);
  const documentId = `v1_${Buffer.from(JSON.stringify([resource.resourceType, resource.resourceId]), 'utf8').toString('base64url')}`;
  if (Buffer.byteLength(documentId, 'utf8') > FIRESTORE_DOCUMENT_ID_MAX_BYTES) {
    throw editLeaseError(400, 'Edit lease resource ID is too long', 'edit_lease_resource_invalid');
  }
  return documentId;
}

export function buildActiveEditLeaseDocument({
  tenantId,
  resourceType,
  resourceId,
  actorId,
  actorDisplayName,
  sessionId,
  leaseId,
  serverNow: nowValue,
  existing,
}) {
  const resource = normalizeResource(resourceType, resourceId);
  const normalizedTenantId = requiredText(tenantId, 'tenantId');
  const normalizedActorId = requiredText(actorId, 'actorId');
  const normalizedSessionId = requiredText(sessionId, 'sessionId');
  const normalizedLeaseId = requiredText(leaseId, 'leaseId');
  const nowMs = toMillis(nowValue);
  if (!Number.isFinite(nowMs)) throw new Error('Edit lease serverNow is invalid');
  const timestamp = asIso(nowMs);
  const expiredFence = requiresExpiryTransition(existing, nowMs) ? auditFence(existing) : null;
  const previousExpiredFence = Number(existing?.lastExpiredFence);
  return {
    tenantId: normalizedTenantId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    holderUid: normalizedActorId,
    holderDisplayName: readOptionalText(actorDisplayName) || '사용자',
    sessionId: normalizedSessionId,
    leaseId: normalizedLeaseId,
    fence: nextFence(existing),
    state: 'ACTIVE',
    acquiredAt: timestamp,
    expiresAt: asIso(nowMs + EDIT_LEASE_TTL_MS),
    updatedAt: timestamp,
    ...((expiredFence || (Number.isSafeInteger(previousExpiredFence) && previousExpiredFence > 0))
      ? { lastExpiredFence: expiredFence || previousExpiredFence }
      : {}),
  };
}

export function buildEditLeaseAuditEntry(current, actorRole, operation, {
  state,
  fence,
  resultCode,
  timestamp,
  effectiveExpiresAt,
  expiryObservedAt,
}) {
  return {
    tenantId: current.tenantId,
    entityType: 'edit_lease',
    entityId: resolveEditLeaseDocumentId(current.resourceType, current.resourceId),
    action: `EDIT_LEASE_${operation.toUpperCase()}`,
    actorId: current.actorId,
    actorRole,
    actorEmailEnc: current.actorEmailEnc,
    requestId: current.requestId,
    details: `Edit lease ${operation}: ${current.resourceType}`,
    metadata: {
      source: 'bff',
      resourceType: current.resourceType,
      resourceId: current.resourceId,
      sessionIdHash: sha256(`${current.tenantId}:${current.sessionId}`),
      fence: Number.isSafeInteger(Number(fence)) && Number(fence) > 0 ? Number(fence) : null,
      state,
      resultCode,
      ...(effectiveExpiresAt ? { effectiveExpiresAt } : {}),
      ...(expiryObservedAt ? { expiryObservedAt } : {}),
    },
    timestamp,
  };
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

export function createEditLeaseService({
  db,
  now = () => Date.now(),
  createLeaseId = randomUUID,
  auditChainService,
  idempotencyService,
  rbacPolicy,
} = {}) {
  if (!db || typeof db.runTransaction !== 'function') {
    throw new Error('Firestore is required for edit leases');
  }
  if (!auditChainService || typeof auditChainService.appendManyInTransaction !== 'function') {
    throw new Error('Atomic audit chain service is required for edit leases');
  }
  if (
    !idempotencyService
    || typeof idempotencyService.checkInTransaction !== 'function'
    || typeof idempotencyService.completeInTransaction !== 'function'
  ) {
    throw new Error('Atomic idempotency service is required for edit leases');
  }
  if (!rbacPolicy) throw new Error('RBAC policy is required for edit leases');

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
      actorEmailEnc: readOptionalText(input?.actorEmailEnc) || undefined,
      requestId: readOptionalText(input?.requestId) || 'edit-lease-request',
      idempotencyKey: readOptionalText(input?.idempotencyKey),
      leaseRef: leaseRefFor(db, tenantId, resource.resourceType, resource.resourceId),
    };
  }

  async function assertResourceAccessInTransaction(tx, current, { requireActiveRegistrationDraft = false } = {}) {
    const { actorRole, member } = await assertEditLeaseActorAccessInTransaction({
      tx,
      db,
      tenantId: current.tenantId,
      actorId: current.actorId,
      rbacPolicy,
    });

    if (current.resourceType === 'project-registration') {
      const draftRef = db.doc(`orgs/${current.tenantId}/projectRequestDrafts/${current.resourceId}`);
      const draftSnap = await tx.get(draftRef);
      const draft = draftSnap.exists ? (draftSnap.data() || {}) : {};
      const ownerId = readOptionalText(draft.ownerUid) || readOptionalText(draft.ownerId);
      if (!draftSnap.exists || ownerId !== current.actorId) {
        throw createHttpError(404, 'Project registration draft not found', 'not_found');
      }
      if (requireActiveRegistrationDraft && readOptionalText(draft.status).toUpperCase() !== 'ACTIVE') {
        throw createHttpError(409, 'Project registration draft is not active', 'draft_not_active');
      }
      return actorRole;
    }

    const projectRef = db.doc(`orgs/${current.tenantId}/projects/${current.resourceId}`);
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw createHttpError(404, 'Project not found', 'not_found');
    const project = projectSnap.data() || {};
    if (!hasEditLeaseProjectAccess({
      actorRole,
      member,
      project,
      projectId: current.resourceId,
      actorId: current.actorId,
    })) {
      throw createHttpError(403, 'Project assignment is required', 'forbidden');
    }
    return actorRole;
  }

  function auditEntry(current, actorRole, operation, {
    state,
    fence,
    resultCode,
    timestamp,
    effectiveExpiresAt,
    expiryObservedAt,
  }) {
    return buildEditLeaseAuditEntry(current, actorRole, operation, {
      state,
      fence,
      resultCode,
      timestamp,
      effectiveExpiresAt,
      expiryObservedAt,
    });
  }

  async function checkIdempotency(tx, current, command, input, nowMs) {
    if (!current.idempotencyKey) return { mode: 'started', ref: null, requestFingerprint: null };
    const requestFingerprint = commandFingerprint(current, command, input);
    return idempotencyService.checkInTransaction(tx, {
      tenantId: current.tenantId,
      idempotencyKey: current.idempotencyKey,
      requestFingerprint,
      nowDate: new Date(nowMs),
    });
  }

  function completeIdempotency(tx, current, command, lock, body, nowMs) {
    if (!current.idempotencyKey) return;
    idempotencyService.completeInTransaction(tx, {
      ref: lock.ref,
      tenantId: current.tenantId,
      idempotencyKey: current.idempotencyKey,
      requestFingerprint: lock.requestFingerprint,
      responseStatus: 200,
      responseBody: body,
      actorId: current.actorId,
      requestId: current.requestId,
      method: 'POST',
      path: commandPath(current, command),
      nowDate: new Date(nowMs),
    });
  }

  function idempotencyError(lock) {
    if (lock.mode === 'conflict') {
      return editLeaseError(409, lock.reason, 'idempotency_conflict');
    }
    if (lock.mode === 'in_progress') {
      return editLeaseError(409, lock.reason, 'idempotency_in_progress');
    }
    return null;
  }

  function expiredLeaseError(lease, nowMs) {
    return editLeaseError(410, 'The edit lease has expired', 'edit_lease_expired', undefined, {
      serverNow: asIso(nowMs),
      fence: auditFence(lease),
    });
  }

  function ownershipError(lease, nowMs) {
    return editLeaseError(423, 'The edit lease is held by another session', 'edit_lease_held', undefined, {
      serverNow: asIso(nowMs),
      fence: auditFence(lease),
    });
  }

  function matchesOwner(lease, current, input) {
    const leaseId = requiredText(input?.leaseId, 'leaseId');
    const fence = Number(input?.fence);
    if (!Number.isSafeInteger(fence) || fence < 1) {
      throw editLeaseError(400, 'fence must be a positive integer', 'edit_lease_request_invalid');
    }
    return readOptionalText(lease?.tenantId) === current.tenantId
      && readOptionalText(lease?.resourceType) === current.resourceType
      && readOptionalText(lease?.resourceId) === current.resourceId
      && readOptionalText(lease?.holderUid) === current.actorId
      && readOptionalText(lease?.sessionId) === current.sessionId
      && readOptionalText(lease?.leaseId) === leaseId
      && Number(lease?.fence) === fence;
  }

  function expiredDocument(lease, timestamp) {
    const effectiveExpiresAt = readOptionalText(lease?.expiresAt) || timestamp;
    return {
      ...lease,
      state: 'EXPIRED',
      expiredAt: lease.expiredAt || effectiveExpiresAt,
      expiryObservedAt: lease.expiryObservedAt || timestamp,
      lastExpiredFence: auditFence(lease),
      updatedAt: timestamp,
    };
  }

  async function runCommand(command, input) {
    const current = context(input);
    const acquireLeaseId = command === 'acquire' || command === 'takeover'
      ? requiredText(createLeaseId(), 'leaseId')
      : null;
    const outcome = await runEditLeaseTransaction(db, async (tx) => {
      const nowMs = serverNow(now);
      const timestamp = asIso(nowMs);
      const actorRole = await assertResourceAccessInTransaction(tx, current, {
        requireActiveRegistrationDraft: command === 'acquire' || command === 'takeover',
      });
      const lock = await checkIdempotency(tx, current, command, input, nowMs);
      if (lock.mode === 'replay') {
        return { status: lock.status, body: lock.body, replayed: true };
      }
      const lockError = idempotencyError(lock);
      if (lockError) throw lockError;

      const snap = await tx.get(current.leaseRef);
      const existing = snap.exists ? (snap.data() || {}) : null;

      if (command === 'acquire' || command === 'takeover') {
        if (activeAt(existing, nowMs)) {
          const sameActor = existing.holderUid === current.actorId;
          const sameSession = sameActor && existing.sessionId === current.sessionId;
          if (sameSession) {
            const body = ownedStatus(existing, nowMs);
            await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, command, {
              state: body.state,
              fence: body.fence,
              resultCode: command === 'takeover' ? 'edit_lease_taken_over' : 'edit_lease_acquired',
              timestamp,
            })]);
            completeIdempotency(tx, current, command, lock, body, nowMs);
            return { status: 200, body, replayed: false };
          }

          if (command === 'takeover' && sameActor) {
            const lease = buildActiveEditLeaseDocument({
              ...current,
              leaseId: acquireLeaseId,
              serverNow: nowMs,
              existing,
            });
            const body = ownedStatus(lease, nowMs);
            await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, 'takeover', {
              state: body.state,
              fence: body.fence,
              resultCode: 'edit_lease_taken_over',
              timestamp,
            })]);
            tx.set(current.leaseRef, lease);
            completeIdempotency(tx, current, command, lock, body, nowMs);
            return { status: 200, body, replayed: false };
          }

          const error = editLeaseError(
            423,
            'The edit lease is held by another session',
            'edit_lease_held',
            heldDetails(existing, current.actorId),
            { serverNow: timestamp, fence: auditFence(existing) },
          );
          await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, 'conflict', {
            state: 'ACTIVE',
            fence: auditFence(existing),
            resultCode: error.code,
            timestamp,
          })]);
          return { error };
        }

        if (command === 'takeover') {
          return { error: expiredLeaseError(existing, nowMs) };
        }

        const expiredFence = requiresExpiryTransition(existing, nowMs) ? auditFence(existing) : null;
        const lease = buildActiveEditLeaseDocument({
          ...current,
          leaseId: acquireLeaseId,
          serverNow: nowMs,
          existing,
        });
        const body = ownedStatus(lease, nowMs);
        const audits = [];
        if (expiredFence) {
          audits.push(auditEntry(current, actorRole, 'expire', {
            state: 'EXPIRED',
            fence: expiredFence,
            resultCode: 'edit_lease_expired',
            timestamp,
            effectiveExpiresAt: existing?.expiresAt,
            expiryObservedAt: timestamp,
          }));
        }
        audits.push(auditEntry(current, actorRole, 'acquire', {
          state: body.state,
          fence: body.fence,
          resultCode: 'edit_lease_acquired',
          timestamp,
        }));
        await auditChainService.appendManyInTransaction(tx, audits);
        tx.set(current.leaseRef, lease);
        completeIdempotency(tx, current, command, lock, body, nowMs);
        return { status: 200, body, replayed: false };
      }

      if (!activeAt(existing, nowMs)) {
        const error = expiredLeaseError(existing, nowMs);
        if (requiresExpiryTransition(existing, nowMs)) {
          const expired = expiredDocument(existing, timestamp);
          await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, 'expire', {
            state: 'EXPIRED',
            fence: auditFence(existing),
            resultCode: error.code,
            timestamp,
            effectiveExpiresAt: existing?.expiresAt,
            expiryObservedAt: timestamp,
          })]);
          tx.set(current.leaseRef, expired);
        }
        return { error };
      }

      if (!matchesOwner(existing, current, input)) {
        const error = ownershipError(existing, nowMs);
        await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, 'conflict', {
          state: 'ACTIVE',
          fence: auditFence(existing),
          resultCode: error.code,
          timestamp,
        })]);
        return { error };
      }

      if (command === 'extend') {
        const extended = {
          ...existing,
          expiresAt: asIso(nowMs + EDIT_LEASE_TTL_MS),
          updatedAt: timestamp,
        };
        const body = ownedStatus(extended, nowMs);
        await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, 'extend', {
          state: body.state,
          fence: body.fence,
          resultCode: 'edit_lease_extended',
          timestamp,
        })]);
        tx.set(current.leaseRef, extended);
        completeIdempotency(tx, current, command, lock, body, nowMs);
        return { status: 200, body, replayed: false };
      }

      const released = { ...existing, state: 'RELEASED', updatedAt: timestamp };
      const body = {
        serverNow: timestamp,
        state: 'RELEASED',
        canEdit: false,
        expiresAt: released.expiresAt,
      };
      await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, 'release', {
        state: body.state,
        fence: auditFence(existing),
        resultCode: 'edit_lease_released',
        timestamp,
      })]);
      tx.set(current.leaseRef, released);
      completeIdempotency(tx, current, command, lock, body, nowMs);
      return { status: 200, body, replayed: false };
    });

    if (outcome.error) throw outcome.error;
    return outcome;
  }

  return {
    async getStatus(input) {
      const current = context(input);
      return runEditLeaseTransaction(db, async (tx) => {
        const nowMs = serverNow(now);
        const timestamp = asIso(nowMs);
        const actorRole = await assertResourceAccessInTransaction(tx, current);
        const snap = await tx.get(current.leaseRef);
        if (!snap.exists) {
          return { serverNow: timestamp, state: 'AVAILABLE', canEdit: false, expiresAt: null };
        }

        const lease = snap.data() || {};
        if (lease.state === 'RELEASED') {
          return { serverNow: timestamp, state: 'RELEASED', canEdit: false, expiresAt: lease.expiresAt || null };
        }
        if (!activeAt(lease, nowMs)) {
          if (requiresExpiryTransition(lease, nowMs)) {
            const expired = expiredDocument(lease, timestamp);
            await auditChainService.appendManyInTransaction(tx, [auditEntry(current, actorRole, 'expire', {
              state: 'EXPIRED',
              fence: auditFence(lease),
              resultCode: 'edit_lease_expired',
              timestamp,
              effectiveExpiresAt: lease.expiresAt,
              expiryObservedAt: timestamp,
            })]);
            tx.set(current.leaseRef, expired);
          }
          return {
            serverNow: timestamp,
            state: 'EXPIRED',
            canEdit: false,
            expiresAt: lease.expiresAt || null,
          };
        }
        if (lease.holderUid === current.actorId && lease.sessionId === current.sessionId) {
          return ownedStatus(lease, nowMs);
        }
        return {
          serverNow: timestamp,
          state: 'ACTIVE',
          canEdit: false,
          expiresAt: lease.expiresAt,
          holderDisplayName: readOptionalText(lease.holderDisplayName) || '다른 사용자',
          sameActor: lease.holderUid === current.actorId,
        };
      });
    },

    acquire: (input) => runCommand('acquire', input),
    takeover: (input) => runCommand('takeover', input),
    extend: (input) => runCommand('extend', input),
    release: (input) => runCommand('release', input),
  };
}
