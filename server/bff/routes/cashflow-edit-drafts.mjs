import { z } from 'zod';
import {
  PROJECT_REQUEST_ROUTE_ROLES,
  assertActorRoleAllowed,
  asyncHandler,
  createHttpError,
  encryptAuditEmail,
  readOptionalText,
} from '../bff-utils.mjs';
import {
  assertEditLeaseActorAccessInTransaction,
  assertOwnedInTransaction,
  hasEditLeaseProjectAccess,
  resolveEditLeaseDocumentId,
} from '../edit-lease.mjs';
import { parseWithSchema } from '../schemas.mjs';
import { buildRequestFingerprint, sha256 } from '../utils.mjs';

const RESOURCE_TYPE = 'cashflow';
const MAX_DRAFT_BYTES = 900 * 1024;
const MAX_PAYLOAD_DEPTH = 20;

const openSchema = z.object({
  baseSnapshot: z.unknown(),
  payload: z.unknown(),
}).strict();
const patchSchema = z.object({
  expectedDraftRevision: z.number().int().nonnegative(),
  payload: z.unknown(),
}).strict();
const completeSchema = z.object({
  expectedDraftRevision: z.number().int().nonnegative(),
}).strict();

function requiredText(value, fieldName) {
  const normalized = readOptionalText(value);
  if (!normalized) throw createHttpError(400, `${fieldName} is required`, 'draft_request_invalid');
  return normalized;
}

function documentId(value, fieldName) {
  const normalized = requiredText(value, fieldName);
  if (
    normalized.includes('/')
    || normalized === '.'
    || normalized === '..'
    || Buffer.byteLength(normalized, 'utf8') > 512
  ) {
    throw createHttpError(400, `${fieldName} is invalid`, 'draft_request_invalid');
  }
  return normalized;
}

function positiveFence(value) {
  const fence = Number(value);
  if (!Number.isSafeInteger(fence) || fence < 1) {
    throw createHttpError(400, 'x-edit-fence must be a positive safe integer', 'draft_request_invalid');
  }
  return fence;
}

function clockDate(now) {
  const date = new Date(now());
  if (!Number.isFinite(date.getTime())) throw new Error('Cashflow edit draft clock returned an invalid time');
  return date;
}

function draftDocumentId(projectId, actorId) {
  const id = `v1_${Buffer.from(JSON.stringify([RESOURCE_TYPE, projectId, actorId]), 'utf8').toString('base64url')}`;
  if (Buffer.byteLength(id, 'utf8') > 1_500) {
    throw createHttpError(400, 'Cashflow edit draft ID is too long', 'draft_request_invalid');
  }
  return id;
}

function invalidPayload() {
  throw createHttpError(422, 'Draft payload contains unsupported JSON data', 'draft_payload_invalid');
}

function assertSafeJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidPayload();
  const ancestors = new WeakSet();
  const stack = [{ value, depth: 0, parentArray: false, exit: false }];
  while (stack.length) {
    const frame = stack.pop();
    if (frame.exit) {
      ancestors.delete(frame.value);
      continue;
    }
    const current = frame.value;
    if (frame.depth > MAX_PAYLOAD_DEPTH) invalidPayload();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Math.abs(current) > Number.MAX_SAFE_INTEGER) invalidPayload();
      continue;
    }
    if (!current || typeof current !== 'object' || ancestors.has(current)) invalidPayload();
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      if (frame.parentArray) invalidPayload();
      ancestors.add(current);
      stack.push({ ...frame, exit: true });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(current, index)) invalidPayload();
        stack.push({ value: current[index], depth: frame.depth + 1, parentArray: true, exit: false });
      }
      continue;
    }
    if (prototype !== Object.prototype && prototype !== null) invalidPayload();
    ancestors.add(current);
    stack.push({ ...frame, exit: true });
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== 'string' || key === '__proto__' || Buffer.byteLength(key, 'utf8') > 1_500) invalidPayload();
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalidPayload();
      stack.push({ value: descriptor.value, depth: frame.depth + 1, parentArray: false, exit: false });
    }
  }
}

function assertDraftSize(value) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    invalidPayload();
  }
  if (bytes > MAX_DRAFT_BYTES) {
    throw createHttpError(413, 'Draft payload is too large', 'draft_payload_too_large');
  }
}

function assertActive(draft) {
  if (draft.status !== 'ACTIVE') {
    throw createHttpError(409, 'Cashflow edit draft is not active', 'draft_not_active');
  }
}

function assertRevision(draft, expected) {
  const actual = Number.isInteger(draft.draftRevision) ? draft.draftRevision : 0;
  if (actual !== expected) {
    throw createHttpError(
      409,
      `Draft revision mismatch: expected ${expected}, actual ${actual}`,
      'draft_version_conflict',
    );
  }
  return actual;
}

function draftContract(draft) {
  return {
    projectId: readOptionalText(draft.resourceId),
    resourceType: RESOURCE_TYPE,
    resourceId: readOptionalText(draft.resourceId),
    draftRevision: Number.isInteger(draft.draftRevision) ? draft.draftRevision : 0,
    status: readOptionalText(draft.status) || 'ACTIVE',
    ...(Object.hasOwn(draft, 'baseSnapshot') ? { baseSnapshot: draft.baseSnapshot } : {}),
    ...(Object.hasOwn(draft, 'payload') ? { payload: draft.payload } : {}),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    ...(draft.submittedAt ? { submittedAt: draft.submittedAt } : {}),
  };
}

function idempotencyError(lock) {
  if (lock.mode === 'conflict') return createHttpError(409, lock.reason, 'idempotency_conflict');
  if (lock.mode === 'in_progress') return createHttpError(409, lock.reason, 'idempotency_in_progress');
  return null;
}

function auditEntry(current, actorRole, action, revision, timestamp) {
  return {
    tenantId: current.tenantId,
    entityType: 'cashflow_edit_draft',
    entityId: current.draftDocumentId,
    action,
    actorId: current.actorId,
    actorRole,
    actorEmailEnc: current.actorEmailEnc,
    requestId: current.requestId,
    details: `Cashflow edit draft: ${action}`,
    metadata: {
      source: 'bff',
      resourceType: RESOURCE_TYPE,
      resourceId: current.projectId,
      sessionIdHash: sha256(`${current.tenantId}:${current.sessionId}`),
      draftRevision: revision,
      fence: current.fence,
    },
    timestamp,
  };
}

export function createCashflowEditDraftService({
  db,
  now = () => new Date().toISOString(),
  auditChainService,
  idempotencyService,
  rbacPolicy,
} = {}) {
  if (!db?.runTransaction) throw new Error('Firestore is required for cashflow edit drafts');
  if (!auditChainService?.appendManyInTransaction) throw new Error('Atomic audit chain service is required');
  if (!idempotencyService?.checkInTransaction || !idempotencyService?.completeInTransaction) {
    throw new Error('Atomic idempotency service is required');
  }
  if (!rbacPolicy) throw new Error('RBAC policy is required');

  function context(input, { ownership = true, idempotency = true } = {}) {
    const tenantId = documentId(input?.tenantId, 'tenantId');
    const actorId = documentId(input?.actorId, 'actorId');
    const projectId = documentId(input?.projectId, 'projectId');
    return {
      tenantId,
      actorId,
      projectId,
      sessionId: ownership ? documentId(input?.sessionId, 'sessionId') : undefined,
      leaseId: ownership ? documentId(input?.leaseId, 'leaseId') : undefined,
      fence: ownership ? positiveFence(input?.fence) : undefined,
      actorEmailEnc: readOptionalText(input?.actorEmailEnc) || undefined,
      requestId: readOptionalText(input?.requestId) || 'cashflow-edit-draft-request',
      idempotencyKey: idempotency ? requiredText(input?.idempotencyKey, 'idempotencyKey') : undefined,
      draftDocumentId: draftDocumentId(projectId, actorId),
    };
  }

  const refs = (current) => ({
    project: db.doc(`orgs/${current.tenantId}/projects/${current.projectId}`),
    draft: db.doc(`orgs/${current.tenantId}/privateEditDrafts/${current.draftDocumentId}`),
    lease: db.doc(`orgs/${current.tenantId}/editLeases/${resolveEditLeaseDocumentId(RESOURCE_TYPE, current.projectId)}`),
  });

  async function accessProject(tx, current) {
    const { actorRole, member } = await assertEditLeaseActorAccessInTransaction({
      tx, db, tenantId: current.tenantId, actorId: current.actorId, rbacPolicy,
    });
    const projectRef = refs(current).project;
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw createHttpError(404, 'Project not found', 'not_found');
    if (!hasEditLeaseProjectAccess({
      actorRole,
      member,
      project: projectSnap.data() || {},
      projectId: current.projectId,
      actorId: current.actorId,
    })) {
      throw createHttpError(403, 'Project assignment is required', 'forbidden');
    }
    return { actorRole };
  }

  async function ownedDraft(tx, current) {
    const access = await accessProject(tx, current);
    const draftRef = refs(current).draft;
    const draftSnap = await tx.get(draftRef);
    const draft = draftSnap.exists ? (draftSnap.data() || {}) : null;
    if (
      !draft
      || readOptionalText(draft.ownerUid) !== current.actorId
      || readOptionalText(draft.resourceType) !== RESOURCE_TYPE
      || readOptionalText(draft.resourceId) !== current.projectId
    ) {
      throw createHttpError(404, 'Cashflow edit draft not found', 'not_found');
    }
    return { ...access, draftRef, draft };
  }

  async function assertLease(tx, current, nowDate) {
    return assertOwnedInTransaction({
      tx,
      leaseRef: refs(current).lease,
      tenantId: current.tenantId,
      resourceType: RESOURCE_TYPE,
      resourceId: current.projectId,
      actorId: current.actorId,
      sessionId: current.sessionId,
      leaseId: current.leaseId,
      fence: current.fence,
      serverNow: nowDate,
    });
  }

  async function assertFinalizedLease(tx, current) {
    const leaseSnap = await tx.get(refs(current).lease);
    if (!leaseSnap.exists) {
      throw createHttpError(410, 'The cashflow edit lease has expired', 'edit_lease_expired');
    }
    const lease = leaseSnap.data() || {};
    const exactOwner = readOptionalText(lease.tenantId) === current.tenantId
      && readOptionalText(lease.resourceType) === RESOURCE_TYPE
      && readOptionalText(lease.resourceId) === current.projectId
      && readOptionalText(lease.holderUid) === current.actorId
      && readOptionalText(lease.sessionId) === current.sessionId
      && readOptionalText(lease.leaseId) === current.leaseId
      && Number(lease.fence) === current.fence;
    if (!exactOwner) {
      throw createHttpError(423, 'The cashflow edit lease is held by another session', 'edit_lease_held');
    }
    if (
      readOptionalText(lease.state).toUpperCase() !== 'RELEASED'
      || readOptionalText(lease.releaseReason) !== 'FINAL_SAVE'
      || !readOptionalText(lease.releasedAt)
    ) {
      throw createHttpError(409, 'The canonical cashflow final save is not complete', 'cashflow_final_save_incomplete');
    }
    return lease;
  }

  async function checkIdempotency(tx, current, fingerprint, nowDate) {
    return idempotencyService.checkInTransaction(tx, {
      tenantId: current.tenantId,
      idempotencyKey: current.idempotencyKey,
      requestFingerprint: fingerprint,
      nowDate,
    });
  }

  function completeIdempotency(tx, current, lock, response, nowDate) {
    idempotencyService.completeInTransaction(tx, {
      ref: lock.ref,
      tenantId: current.tenantId,
      idempotencyKey: current.idempotencyKey,
      requestFingerprint: lock.requestFingerprint,
      responseStatus: response.status,
      responseBody: response.body,
      actorId: current.actorId,
      requestId: current.requestId,
      method: response.method,
      path: response.path,
      nowDate,
      ...(response.ttlSeconds ? { ttlSeconds: response.ttlSeconds } : {}),
    });
  }

  return {
    async get(input) {
      const current = context(input, { ownership: false, idempotency: false });
      return db.runTransaction(async (tx) => {
        const { draft } = await ownedDraft(tx, current);
        return { draft: draftContract(draft) };
      });
    },

    async open(input) {
      const current = context(input);
      const baseSnapshot = input?.baseSnapshot;
      const payload = input?.payload;
      assertSafeJsonObject(baseSnapshot);
      assertSafeJsonObject(payload);
      assertDraftSize({ baseSnapshot, payload });
      const method = 'POST';
      const path = `/api/v1/cashflow-edit-drafts/${current.projectId}/open`;
      const fingerprint = buildRequestFingerprint({
        method,
        path,
        body: {
          actorId: current.actorId, sessionId: current.sessionId, leaseId: current.leaseId,
          fence: current.fence, baseSnapshot, payload,
        },
      });
      return db.runTransaction(async (tx) => {
        const nowDate = clockDate(now);
        const timestamp = nowDate.toISOString();
        const { actorRole } = await accessProject(tx, current);
        const draftRef = refs(current).draft;
        const draftSnap = await tx.get(draftRef);
        const lock = await checkIdempotency(tx, current, fingerprint, nowDate);
        if (lock.mode === 'replay') return { status: lock.status, body: lock.body, replayed: true };
        const lockError = idempotencyError(lock);
        if (lockError) throw lockError;
        await assertLease(tx, current, nowDate);
        const existing = draftSnap.exists ? (draftSnap.data() || {}) : null;
        const draft = existing?.status === 'ACTIVE'
          && readOptionalText(existing.ownerUid) === current.actorId
          && readOptionalText(existing.resourceType) === RESOURCE_TYPE
          && readOptionalText(existing.resourceId) === current.projectId
          ? existing
          : {
              ownerUid: current.actorId,
              tenantId: current.tenantId,
              resourceType: RESOURCE_TYPE,
              resourceId: current.projectId,
              draftRevision: 0,
              baseSnapshot,
              payload,
              status: 'ACTIVE',
              createdAt: timestamp,
              updatedAt: timestamp,
            };
        assertDraftSize(draft);
        const body = { draft: draftContract(draft) };
        if (draft !== existing) {
          await auditChainService.appendManyInTransaction(tx, [
            auditEntry(current, actorRole, 'CASHFLOW_EDIT_DRAFT_OPEN', 0, timestamp),
          ]);
          tx.set(draftRef, draft);
        }
        completeIdempotency(tx, current, lock, { method, path, status: 200, body }, nowDate);
        return { status: 200, body, replayed: false };
      });
    },

    async update(input) {
      const current = context(input);
      const expectedDraftRevision = Number(input?.expectedDraftRevision);
      const payload = input?.payload;
      if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) {
        throw createHttpError(400, 'expectedDraftRevision is invalid', 'draft_request_invalid');
      }
      assertSafeJsonObject(payload);
      assertDraftSize({ payload });
      const method = 'PATCH';
      const path = `/api/v1/cashflow-edit-drafts/${current.projectId}`;
      const fingerprint = buildRequestFingerprint({
        method,
        path,
        body: {
          actorId: current.actorId, sessionId: current.sessionId, leaseId: current.leaseId,
          fence: current.fence, expectedDraftRevision, payload,
        },
      });
      return db.runTransaction(async (tx) => {
        const nowDate = clockDate(now);
        const timestamp = nowDate.toISOString();
        const { actorRole, draftRef, draft } = await ownedDraft(tx, current);
        const lock = await checkIdempotency(tx, current, fingerprint, nowDate);
        if (lock.mode === 'replay') return { status: lock.status, body: lock.body, replayed: true };
        const lockError = idempotencyError(lock);
        if (lockError) throw lockError;
        assertActive(draft);
        await assertLease(tx, current, nowDate);
        const revision = assertRevision(draft, expectedDraftRevision) + 1;
        const next = { ...draft, payload, draftRevision: revision, updatedAt: timestamp };
        assertDraftSize(next);
        const body = { draft: draftContract(next) };
        await auditChainService.appendManyInTransaction(tx, [
          auditEntry(current, actorRole, 'CASHFLOW_EDIT_DRAFT_SAVE', revision, timestamp),
        ]);
        tx.set(draftRef, next);
        completeIdempotency(tx, current, lock, { method, path, status: 200, body }, nowDate);
        return { status: 200, body, replayed: false };
      });
    },

    async complete(input) {
      const current = context(input);
      const expectedDraftRevision = Number(input?.expectedDraftRevision);
      if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) {
        throw createHttpError(400, 'expectedDraftRevision is invalid', 'draft_request_invalid');
      }
      const method = 'POST';
      const path = `/api/v1/cashflow-edit-drafts/${current.projectId}/complete`;
      const fingerprint = buildRequestFingerprint({
        method,
        path,
        body: {
          actorId: current.actorId, sessionId: current.sessionId, leaseId: current.leaseId,
          fence: current.fence, expectedDraftRevision,
        },
      });
      return db.runTransaction(async (tx) => {
        const nowDate = clockDate(now);
        const timestamp = nowDate.toISOString();
        const { actorRole, draftRef, draft } = await ownedDraft(tx, current);
        const lock = await checkIdempotency(tx, current, fingerprint, nowDate);
        if (lock.mode === 'replay') return { status: lock.status, body: lock.body, replayed: true };
        const lockError = idempotencyError(lock);
        if (lockError) throw lockError;
        assertActive(draft);
        const lease = await assertFinalizedLease(tx, current);
        const revision = assertRevision(draft, expectedDraftRevision) + 1;
        const next = {
          ownerUid: current.actorId,
          tenantId: current.tenantId,
          resourceType: RESOURCE_TYPE,
          resourceId: current.projectId,
          draftRevision: revision,
          status: 'SUBMITTED',
          createdAt: draft.createdAt || timestamp,
          updatedAt: timestamp,
          submittedAt: timestamp,
        };
        const body = {
          status: 'SUBMITTED',
          projectId: current.projectId,
          draftRevision: revision,
          submittedAt: timestamp,
          draft: draftContract(next),
          lease: {
            state: 'RELEASED',
            canEdit: false,
            leaseId: lease.leaseId,
            fence: lease.fence,
            releasedAt: lease.releasedAt,
          },
        };
        await auditChainService.appendManyInTransaction(tx, [
          auditEntry(current, actorRole, 'CASHFLOW_EDIT_DRAFT_COMPLETE', revision, timestamp),
        ]);
        tx.set(draftRef, next);
        completeIdempotency(tx, current, lock, { method, path, status: 200, body, ttlSeconds: 86_400 }, nowDate);
        return { status: 200, body, replayed: false };
      });
    },
  };
}

function requireHeader(req, name) {
  return documentId(req.header(name), name);
}

function routeProjectId(req) {
  return documentId(req.params?.projectId, 'projectId');
}

function routeOwnership(req) {
  const sessionId = requireHeader(req, 'x-edit-session-id');
  const leaseId = requireHeader(req, 'x-edit-lease-id');
  const rawFence = requireHeader(req, 'x-edit-fence');
  if (!/^[1-9]\d*$/.test(rawFence)) {
    throw createHttpError(400, 'x-edit-fence must be a positive integer', 'draft_request_invalid');
  }
  return { sessionId, leaseId, fence: positiveFence(rawFence) };
}

async function routeContext(req, piiProtector) {
  return {
    tenantId: req.context?.tenantId,
    actorId: req.context?.actorId,
    actorEmailEnc: piiProtector
      ? await encryptAuditEmail(piiProtector, req.context?.actorEmail)
      : undefined,
    requestId: req.context?.requestId,
    idempotencyKey: req.context?.idempotencyKey,
  };
}

function sendOutcome(res, outcome) {
  if (outcome.replayed) res.setHeader('x-idempotency-replayed', '1');
  res.status(outcome.status).json(outcome.body);
}

export function mountCashflowEditDraftRoutes(app, {
  enabled = false,
  cashflowEditDraftService,
  piiProtector,
} = {}) {
  if (!enabled) return;
  if (!cashflowEditDraftService) throw new Error('Cashflow edit draft routes require a service');

  app.get('/api/v1/cashflow-edit-drafts/:projectId', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'read a cashflow edit draft');
    res.status(200).json(await cashflowEditDraftService.get({
      ...await routeContext(req, piiProtector), projectId: routeProjectId(req),
    }));
  }));

  app.post('/api/v1/cashflow-edit-drafts/:projectId/open', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'open a cashflow edit draft');
    const parsed = parseWithSchema(openSchema, req.body);
    sendOutcome(res, await cashflowEditDraftService.open({
      ...await routeContext(req, piiProtector), ...routeOwnership(req),
      projectId: routeProjectId(req), ...parsed,
    }));
  }));

  app.patch('/api/v1/cashflow-edit-drafts/:projectId', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'save a cashflow edit draft');
    const parsed = parseWithSchema(patchSchema, req.body);
    sendOutcome(res, await cashflowEditDraftService.update({
      ...await routeContext(req, piiProtector), ...routeOwnership(req),
      projectId: routeProjectId(req), ...parsed,
    }));
  }));

  app.post('/api/v1/cashflow-edit-drafts/:projectId/complete', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'complete a cashflow edit draft');
    const parsed = parseWithSchema(completeSchema, req.body);
    sendOutcome(res, await cashflowEditDraftService.complete({
      ...await routeContext(req, piiProtector), ...routeOwnership(req),
      projectId: routeProjectId(req), ...parsed,
    }));
  }));
}
