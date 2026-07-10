import { randomUUID } from 'node:crypto';
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
  buildActiveEditLeaseDocument,
  buildEditLeaseAuditEntry,
  resolveEditLeaseDocumentId,
} from '../edit-lease.mjs';
import {
  parseWithSchema,
  projectRegistrationDraftAttachmentSchema,
  projectRegistrationDraftCreateSchema,
  projectRegistrationDraftPatchSchema,
} from '../schemas.mjs';
import { buildRequestFingerprint, sha256 } from '../utils.mjs';

const RESOURCE_TYPE = 'project-registration';
const MAX_DRAFT_DOCUMENT_BYTES = 900 * 1024;
const MAX_ATTACHMENT_REFS = 100;
const MAX_DRAFT_PAYLOAD_DEPTH = 20;
const MAX_FIRESTORE_FIELD_NAME_BYTES = 1_500;

function requiredText(value, fieldName) {
  const normalized = readOptionalText(value);
  if (!normalized) throw createHttpError(400, `${fieldName} is required`, 'draft_request_invalid');
  return normalized;
}

function documentId(value, fieldName) {
  const normalized = requiredText(value, fieldName);
  if (normalized.includes('/') || Buffer.byteLength(normalized, 'utf8') > 1_500) {
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

function clockDate(clock) {
  const date = new Date(clock());
  if (!Number.isFinite(date.getTime())) throw new Error('Project registration draft clock returned an invalid time');
  return date;
}

function safeLegacyOwnerId(actorId) {
  const normalized = actorId
    .replace(/[^A-Za-z0-9가-힣._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'unknown';
}

function ownerId(draft = {}) {
  return readOptionalText(draft.ownerUid) || readOptionalText(draft.ownerId);
}

function attachmentRefs(draft = {}) {
  return Array.isArray(draft.attachmentRefs) ? draft.attachmentRefs : [];
}

function draftContract(draft = {}) {
  return {
    draftId: readOptionalText(draft.resourceId),
    resourceType: RESOURCE_TYPE,
    resourceId: readOptionalText(draft.resourceId),
    draftRevision: Number.isInteger(draft.draftRevision) ? draft.draftRevision : 0,
    payload: draft.payload && typeof draft.payload === 'object' && !Array.isArray(draft.payload)
      ? draft.payload
      : {},
    attachmentRefs: attachmentRefs(draft),
    stepIndex: Number.isInteger(draft.stepIndex) && draft.stepIndex >= 0 ? draft.stepIndex : 0,
    status: readOptionalText(draft.status) || 'ACTIVE',
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    ...(draft.submittedAt ? { submittedAt: draft.submittedAt } : {}),
  };
}

function assertDraftSize(draft) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(draft), 'utf8');
  } catch {
    throw createHttpError(422, 'Draft payload cannot be serialized', 'draft_payload_invalid');
  }
  if (bytes > MAX_DRAFT_DOCUMENT_BYTES) {
    throw createHttpError(413, 'Draft payload is too large', 'draft_payload_too_large');
  }
}

function invalidDraftPayload() {
  throw createHttpError(422, 'Draft payload contains unsupported JSON data', 'draft_payload_invalid');
}

function assertDraftPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalidDraftPayload();
  let rootPrototype;
  try {
    rootPrototype = Object.getPrototypeOf(payload);
  } catch {
    invalidDraftPayload();
  }
  if (rootPrototype !== Object.prototype && rootPrototype !== null) invalidDraftPayload();

  const activeAncestors = new WeakSet();
  const stack = [{ value: payload, depth: 0, parentIsArray: false, exiting: false }];

  while (stack.length > 0) {
    const frame = stack.pop();
    const { value, depth, parentIsArray, exiting } = frame;
    if (exiting) {
      activeAncestors.delete(value);
      continue;
    }
    if (depth > MAX_DRAFT_PAYLOAD_DEPTH) invalidDraftPayload();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) invalidDraftPayload();
      continue;
    }
    if (!value || typeof value !== 'object') invalidDraftPayload();
    if (activeAncestors.has(value)) invalidDraftPayload();

    if (Array.isArray(value)) {
      if (parentIsArray) invalidDraftPayload();
      let ownKeys;
      try {
        ownKeys = Reflect.ownKeys(value);
      } catch {
        invalidDraftPayload();
      }
      if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) invalidDraftPayload();
      activeAncestors.add(value);
      stack.push({ value, depth, parentIsArray, exiting: true });
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const key = String(index);
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          invalidDraftPayload();
        }
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalidDraftPayload();
        stack.push({ value: descriptor.value, depth: depth + 1, parentIsArray: true, exiting: false });
      }
      continue;
    }

    let prototype;
    let ownKeys;
    try {
      prototype = Object.getPrototypeOf(value);
      ownKeys = Reflect.ownKeys(value);
    } catch {
      invalidDraftPayload();
    }
    if (prototype !== Object.prototype && prototype !== null) invalidDraftPayload();
    const entries = [];
    for (const key of ownKeys) {
      if (
        typeof key !== 'string'
        || key === '__proto__'
        || Buffer.byteLength(key, 'utf8') > MAX_FIRESTORE_FIELD_NAME_BYTES
      ) {
        invalidDraftPayload();
      }
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        invalidDraftPayload();
      }
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalidDraftPayload();
      entries.push(descriptor.value);
    }
    activeAncestors.add(value);
    stack.push({ value, depth, parentIsArray, exiting: true });
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      stack.push({ value: entries[index], depth: depth + 1, parentIsArray: false, exiting: false });
    }
  }
}

function readDraftPayload(input, { allowMissing = false } = {}) {
  const hasPayload = Boolean(input && typeof input === 'object' && Object.hasOwn(input, 'payload'));
  if (!hasPayload) {
    if (allowMissing) return {};
    invalidDraftPayload();
  }
  const payload = input.payload;
  assertDraftPayload(payload);
  return payload;
}

function idempotencyError(lock) {
  if (lock.mode === 'conflict') {
    return createHttpError(409, lock.reason, 'idempotency_conflict');
  }
  if (lock.mode === 'in_progress') {
    return createHttpError(409, lock.reason, 'idempotency_in_progress');
  }
  return null;
}

function defaultDraftId() {
  return `prd_${randomUUID().replace(/-/g, '')}`;
}

function defaultAttachmentId() {
  return `att_${randomUUID().replace(/-/g, '')}`;
}

function draftAudit(current, actorRole, action, revision, timestamp, metadata = {}) {
  return {
    tenantId: current.tenantId,
    entityType: 'project_registration_draft',
    entityId: current.draftId,
    action,
    actorId: current.actorId,
    actorRole,
    actorEmailEnc: current.actorEmailEnc,
    requestId: current.requestId,
    details: `Project registration draft ${action.toLowerCase()}`,
    metadata: {
      source: 'bff',
      resourceType: RESOURCE_TYPE,
      resourceId: current.draftId,
      sessionIdHash: sha256(`${current.tenantId}:${current.sessionId}`),
      draftRevision: revision,
      ...metadata,
    },
    timestamp,
  };
}

export function createProjectRegistrationDraftService({
  db,
  now = () => new Date().toISOString(),
  createDraftId = defaultDraftId,
  createLeaseId = randomUUID,
  createAttachmentId = defaultAttachmentId,
  auditChainService,
  idempotencyService,
  draftStorageService,
  rbacPolicy,
} = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Firestore is required for project registration drafts');
  if (!auditChainService || typeof auditChainService.appendManyInTransaction !== 'function') {
    throw new Error('Atomic audit chain service is required for project registration drafts');
  }
  if (!idempotencyService?.checkInTransaction || !idempotencyService?.completeInTransaction) {
    throw new Error('Atomic idempotency service is required for project registration drafts');
  }
  if (!rbacPolicy) throw new Error('RBAC policy is required for project registration drafts');

  function context(input, { draftRequired = true, sessionRequired = true, idempotencyRequired = true } = {}) {
    const tenantId = documentId(input?.tenantId, 'tenantId');
    const actorId = documentId(input?.actorId, 'actorId');
    const draftId = draftRequired ? documentId(input?.draftId, 'draftId') : undefined;
    return {
      tenantId,
      actorId,
      draftId,
      actorDisplayName: readOptionalText(input?.actorDisplayName) || '사용자',
      actorEmailEnc: readOptionalText(input?.actorEmailEnc) || undefined,
      requestId: readOptionalText(input?.requestId) || 'project-registration-draft-request',
      idempotencyKey: idempotencyRequired ? requiredText(input?.idempotencyKey, 'idempotencyKey') : undefined,
      sessionId: sessionRequired ? documentId(input?.sessionId, 'sessionId') : undefined,
    };
  }

  function draftRef(current) {
    return db.doc(`orgs/${current.tenantId}/projectRequestDrafts/${current.draftId}`);
  }

  function leaseRef(current) {
    return db.doc(
      `orgs/${current.tenantId}/editLeases/${resolveEditLeaseDocumentId(RESOURCE_TYPE, current.draftId)}`,
    );
  }

  async function actorAccess(tx, current) {
    return assertEditLeaseActorAccessInTransaction({
      tx,
      db,
      tenantId: current.tenantId,
      actorId: current.actorId,
      rbacPolicy,
    });
  }

  async function ownedDraft(tx, current) {
    const access = await actorAccess(tx, current);
    const ref = draftRef(current);
    const snap = await tx.get(ref);
    const draft = snap.exists ? (snap.data() || {}) : null;
    if (!draft || ownerId(draft) !== current.actorId) {
      throw createHttpError(404, 'Project registration draft not found', 'not_found');
    }
    return { ...access, ref, draft };
  }

  async function checkIdempotency(tx, current, requestFingerprint, nowDate) {
    return idempotencyService.checkInTransaction(tx, {
      tenantId: current.tenantId,
      idempotencyKey: current.idempotencyKey,
      requestFingerprint,
      nowDate,
    });
  }

  function completeIdempotency(tx, current, lock, { method, path, status, body }, nowDate) {
    idempotencyService.completeInTransaction(tx, {
      ref: lock.ref,
      tenantId: current.tenantId,
      idempotencyKey: current.idempotencyKey,
      requestFingerprint: lock.requestFingerprint,
      responseStatus: status,
      responseBody: body,
      actorId: current.actorId,
      requestId: current.requestId,
      method,
      path,
      nowDate,
    });
  }

  function assertActive(draft) {
    if (draft.status !== 'ACTIVE') {
      throw createHttpError(409, 'Project registration draft is not active', 'draft_not_active');
    }
  }

  function assertRevision(draft, expectedDraftRevision) {
    const actual = Number.isInteger(draft.draftRevision) ? draft.draftRevision : 0;
    if (actual !== expectedDraftRevision) {
      throw createHttpError(
        409,
        `Draft revision mismatch: expected ${expectedDraftRevision}, actual ${actual}`,
        'draft_version_conflict',
      );
    }
    return actual;
  }

  return {
    async create(input) {
      const current = context(input, { draftRequired: false });
      current.draftId = documentId(createDraftId(), 'draftId');
      const generatedLeaseId = documentId(createLeaseId(), 'leaseId');
      const payload = readDraftPayload(input, { allowMissing: true });
      const stepIndex = Number.isInteger(input?.stepIndex) && input.stepIndex >= 0 ? input.stepIndex : 0;
      const method = 'POST';
      const path = '/api/v1/project-registration-drafts';
      const requestFingerprint = buildRequestFingerprint({
        method,
        path,
        body: { actorId: current.actorId, sessionId: current.sessionId, payload, stepIndex },
      });
      const targetDraftRef = draftRef(current);
      const targetLeaseRef = leaseRef(current);
      const legacyRef = db.doc(
        `orgs/${current.tenantId}/projectRequestDrafts/registration-${safeLegacyOwnerId(current.actorId)}`,
      );

      return db.runTransaction(async (tx) => {
        const nowDate = clockDate(now);
        const timestamp = nowDate.toISOString();
        const { actorRole } = await actorAccess(tx, current);
        const lock = await checkIdempotency(tx, current, requestFingerprint, nowDate);
        if (lock.mode === 'replay') return { status: lock.status, body: lock.body, replayed: true };
        const lockError = idempotencyError(lock);
        if (lockError) throw lockError;

        const legacySnap = await tx.get(legacyRef);
        const legacy = legacySnap.exists ? (legacySnap.data() || {}) : null;
        const adoptLegacy = legacy
          && ownerId(legacy) === current.actorId
          && readOptionalText(legacy.status).toUpperCase() === 'DRAFT'
          && readOptionalText(legacy.migrationStatus).toUpperCase() !== 'ADOPTED';
        const adoptedPayload = adoptLegacy
          ? (legacy.payload && typeof legacy.payload === 'object' ? legacy.payload : legacy.payloadSnapshot)
          : null;
        const adoptedAttachments = adoptLegacy
          ? (Array.isArray(legacy.attachmentRefs)
            ? legacy.attachmentRefs
            : (Array.isArray(legacy.attachments) ? legacy.attachments : []))
          : [];
        const draft = {
          ownerUid: current.actorId,
          ownerId: current.actorId,
          tenantId: current.tenantId,
          resourceType: RESOURCE_TYPE,
          resourceId: current.draftId,
          draftRevision: 0,
          payload: adoptedPayload && typeof adoptedPayload === 'object' && !Array.isArray(adoptedPayload)
            ? adoptedPayload
            : payload,
          attachmentRefs: adoptedAttachments,
          stepIndex: adoptLegacy && Number.isInteger(legacy.stepIndex) && legacy.stepIndex >= 0
            ? legacy.stepIndex
            : stepIndex,
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        assertDraftSize(draft);
        const lease = buildActiveEditLeaseDocument({
          tenantId: current.tenantId,
          resourceType: RESOURCE_TYPE,
          resourceId: current.draftId,
          actorId: current.actorId,
          actorDisplayName: current.actorDisplayName,
          sessionId: current.sessionId,
          leaseId: generatedLeaseId,
          serverNow: nowDate,
        });
        const body = {
          draft: draftContract(draft),
          lease: {
            serverNow: timestamp,
            state: 'ACTIVE',
            canEdit: true,
            expiresAt: lease.expiresAt,
            leaseId: lease.leaseId,
            fence: lease.fence,
          },
        };
        await auditChainService.appendManyInTransaction(tx, [
          draftAudit(current, actorRole, 'PROJECT_REGISTRATION_DRAFT_CREATE', 0, timestamp, {
            adoptedLegacy: Boolean(adoptLegacy),
          }),
          buildEditLeaseAuditEntry({
            ...current,
            resourceType: RESOURCE_TYPE,
            resourceId: current.draftId,
          }, actorRole, 'acquire', {
            state: 'ACTIVE',
            fence: lease.fence,
            resultCode: 'edit_lease_acquired',
            timestamp,
          }),
        ]);
        tx.create(targetDraftRef, draft);
        tx.create(targetLeaseRef, lease);
        if (adoptLegacy) {
          tx.set(legacyRef, {
            migrationStatus: 'ADOPTED',
            adoptedByDraftId: current.draftId,
            adoptedAt: timestamp,
            updatedAt: timestamp,
          }, { merge: true });
        }
        completeIdempotency(tx, current, lock, { method, path, status: 201, body }, nowDate);
        return { status: 201, body, replayed: false };
      });
    },

    async get(input) {
      const current = context(input, { sessionRequired: false, idempotencyRequired: false });
      return db.runTransaction(async (tx) => {
        const { draft } = await ownedDraft(tx, current);
        return { draft: draftContract(draft) };
      });
    },

    async update(input) {
      const current = context(input);
      const leaseId = documentId(input?.leaseId, 'leaseId');
      const fence = positiveFence(input?.fence);
      const expectedDraftRevision = Number(input?.expectedDraftRevision);
      if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) {
        throw createHttpError(400, 'expectedDraftRevision must be a non-negative integer', 'draft_request_invalid');
      }
      const payload = readDraftPayload(input);
      const method = 'PATCH';
      const path = `/api/v1/project-registration-drafts/${current.draftId}`;
      const requestFingerprint = buildRequestFingerprint({
        method,
        path,
        body: {
          actorId: current.actorId,
          sessionId: current.sessionId,
          leaseId,
          fence,
          expectedDraftRevision,
          payload,
          stepIndex: input?.stepIndex ?? null,
        },
      });

      return db.runTransaction(async (tx) => {
        const nowDate = clockDate(now);
        const timestamp = nowDate.toISOString();
        const { actorRole, ref, draft } = await ownedDraft(tx, current);
        const lock = await checkIdempotency(tx, current, requestFingerprint, nowDate);
        if (lock.mode === 'replay') return { status: lock.status, body: lock.body, replayed: true };
        const lockError = idempotencyError(lock);
        if (lockError) throw lockError;
        assertActive(draft);
        await assertOwnedInTransaction({
          tx,
          leaseRef: leaseRef(current),
          tenantId: current.tenantId,
          resourceType: RESOURCE_TYPE,
          resourceId: current.draftId,
          actorId: current.actorId,
          sessionId: current.sessionId,
          leaseId,
          fence,
          serverNow: nowDate,
        });
        const revision = assertRevision(draft, expectedDraftRevision) + 1;
        const next = {
          ...draft,
          payload,
          stepIndex: Number.isInteger(input?.stepIndex) && input.stepIndex >= 0
            ? input.stepIndex
            : (Number.isInteger(draft.stepIndex) ? draft.stepIndex : 0),
          draftRevision: revision,
          updatedAt: timestamp,
        };
        assertDraftSize(next);
        const body = { draft: draftContract(next) };
        await auditChainService.appendManyInTransaction(tx, [
          draftAudit(current, actorRole, 'PROJECT_REGISTRATION_DRAFT_SAVE', revision, timestamp, { fence }),
        ]);
        tx.set(ref, next);
        completeIdempotency(tx, current, lock, { method, path, status: 200, body }, nowDate);
        return { status: 200, body, replayed: false };
      });
    },

    async addAttachment(input) {
      if (!draftStorageService?.uploadDraftAttachment || !draftStorageService?.deleteDraftAttachment) {
        throw new Error('Draft attachment storage service is required');
      }
      const current = context(input);
      const leaseId = documentId(input?.leaseId, 'leaseId');
      const fence = positiveFence(input?.fence);
      const expectedDraftRevision = Number(input?.expectedDraftRevision);
      if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) {
        throw createHttpError(400, 'expectedDraftRevision must be a non-negative integer', 'draft_request_invalid');
      }
      const buffer = Buffer.isBuffer(input?.buffer)
        ? input.buffer
        : (input?.buffer instanceof Uint8Array ? Buffer.from(input.buffer) : null);
      if (!buffer || buffer.byteLength < 1) {
        throw createHttpError(400, 'Attachment content is required', 'draft_attachment_invalid');
      }
      if (Number(input?.fileSize) !== buffer.byteLength) {
        throw createHttpError(422, 'Attachment size does not match its content', 'draft_attachment_size_mismatch');
      }
      const fileName = requiredText(input?.fileName, 'fileName');
      const mimeType = requiredText(input?.mimeType, 'mimeType');
      const attachmentId = documentId(createAttachmentId(), 'attachmentId');
      const method = 'POST';
      const path = `/api/v1/project-registration-drafts/${current.draftId}/attachments`;
      const requestFingerprint = buildRequestFingerprint({
        method,
        path,
        body: {
          actorId: current.actorId,
          sessionId: current.sessionId,
          leaseId,
          fence,
          expectedDraftRevision,
          fileName,
          mimeType,
          fileSize: buffer.byteLength,
          contentHash: sha256(buffer),
        },
      });

      const preflight = await db.runTransaction(async (tx) => {
        const nowDate = clockDate(now);
        const { draft } = await ownedDraft(tx, current);
        const lock = await checkIdempotency(tx, current, requestFingerprint, nowDate);
        if (lock.mode === 'replay') return { outcome: { status: lock.status, body: lock.body, replayed: true } };
        const lockError = idempotencyError(lock);
        if (lockError) throw lockError;
        assertActive(draft);
        await assertOwnedInTransaction({
          tx,
          leaseRef: leaseRef(current),
          tenantId: current.tenantId,
          resourceType: RESOURCE_TYPE,
          resourceId: current.draftId,
          actorId: current.actorId,
          sessionId: current.sessionId,
          leaseId,
          fence,
          serverNow: nowDate,
        });
        assertRevision(draft, expectedDraftRevision);
        if (attachmentRefs(draft).length >= MAX_ATTACHMENT_REFS) {
          throw createHttpError(422, 'Draft attachment limit exceeded', 'draft_attachment_limit_exceeded');
        }
        return { outcome: null };
      });
      if (preflight.outcome) return preflight.outcome;

      let uploaded;
      const cleanup = async () => {
        if (!uploaded?.path) return;
        try {
          await draftStorageService.deleteDraftAttachment({
            tenantId: current.tenantId,
            draftId: current.draftId,
            path: uploaded.path,
          });
        } catch {
          // eslint-disable-next-line no-console
          console.warn('[bff] draft attachment cleanup failed', {
            requestId: current.requestId,
            errorCode: 'draft_attachment_cleanup_failed',
          });
        }
      };

      try {
        uploaded = await draftStorageService.uploadDraftAttachment({
          tenantId: current.tenantId,
          draftId: current.draftId,
          attachmentId,
          fileName,
          mimeType,
          fileSize: buffer.byteLength,
          buffer,
          actorId: current.actorId,
        });
        const storagePath = readOptionalText(uploaded?.path);
        const expectedPrefix = `orgs/${current.tenantId}/project-registration-drafts/${current.draftId}/`;
        if (!storagePath.startsWith(expectedPrefix)) {
          throw new Error('Draft storage returned a path outside the private draft prefix');
        }
        const attachment = {
          attachmentId,
          path: storagePath,
          name: fileName,
          size: buffer.byteLength,
          contentType: mimeType,
          uploadedAt: readOptionalText(uploaded?.uploadedAt) || clockDate(now).toISOString(),
        };

        const outcome = await db.runTransaction(async (tx) => {
          const nowDate = clockDate(now);
          const timestamp = nowDate.toISOString();
          const { actorRole, ref, draft } = await ownedDraft(tx, current);
          const lock = await checkIdempotency(tx, current, requestFingerprint, nowDate);
          if (lock.mode === 'replay') return { status: lock.status, body: lock.body, replayed: true };
          const lockError = idempotencyError(lock);
          if (lockError) throw lockError;
          assertActive(draft);
          await assertOwnedInTransaction({
            tx,
            leaseRef: leaseRef(current),
            tenantId: current.tenantId,
            resourceType: RESOURCE_TYPE,
            resourceId: current.draftId,
            actorId: current.actorId,
            sessionId: current.sessionId,
            leaseId,
            fence,
            serverNow: nowDate,
          });
          const revision = assertRevision(draft, expectedDraftRevision) + 1;
          const next = {
            ...draft,
            attachmentRefs: [...attachmentRefs(draft), attachment],
            draftRevision: revision,
            updatedAt: timestamp,
          };
          assertDraftSize(next);
          const body = { draft: draftContract(next), attachment };
          await auditChainService.appendManyInTransaction(tx, [
            draftAudit(current, actorRole, 'PROJECT_REGISTRATION_DRAFT_ATTACHMENT_ADD', revision, timestamp, {
              fence,
              attachmentId,
            }),
          ]);
          tx.set(ref, next);
          completeIdempotency(tx, current, lock, { method, path, status: 200, body }, nowDate);
          return { status: 200, body, replayed: false };
        });
        if (outcome.replayed) await cleanup();
        return outcome;
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  };
}

function requireHeader(req, name) {
  return requiredText(req.header(name), name);
}

function routeDraftId(req) {
  return documentId(req.params?.draftId, 'draftId');
}

function routeSession(req) {
  return documentId(requireHeader(req, 'x-edit-session-id'), 'sessionId');
}

function routeOwnership(req) {
  return {
    sessionId: routeSession(req),
    leaseId: documentId(requireHeader(req, 'x-edit-lease-id'), 'leaseId'),
    fence: positiveFence(requireHeader(req, 'x-edit-fence')),
  };
}

async function routeContext(req, piiProtector) {
  const actorEmailEnc = piiProtector
    ? await encryptAuditEmail(piiProtector, req.context?.actorEmail)
    : undefined;
  return {
    tenantId: req.context?.tenantId,
    actorId: req.context?.actorId,
    actorRole: req.context?.actorRole,
    actorDisplayName: req.context?.actorName,
    actorEmailEnc,
    requestId: req.context?.requestId,
    idempotencyKey: req.context?.idempotencyKey,
  };
}

function sendOutcome(res, outcome) {
  if (outcome.replayed) res.setHeader('x-idempotency-replayed', '1');
  res.status(outcome.status).json(outcome.body);
}

function decodeBase64(value, expectedSize) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw createHttpError(400, 'contentBase64 is invalid', 'draft_attachment_invalid');
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.byteLength !== expectedSize) {
    throw createHttpError(422, 'Attachment size does not match its content', 'draft_attachment_size_mismatch');
  }
  return buffer;
}

export function mountProjectRegistrationDraftRoutes(app, {
  enabled = false,
  projectRegistrationDraftService,
  piiProtector,
} = {}) {
  if (!enabled) return;
  if (!projectRegistrationDraftService) throw new Error('Project registration draft routes require a service');

  app.post('/api/v1/project-registration-drafts', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'create a project registration draft');
    const parsed = parseWithSchema(projectRegistrationDraftCreateSchema, req.body);
    const current = await routeContext(req, piiProtector);
    sendOutcome(res, await projectRegistrationDraftService.create({
      ...current,
      sessionId: routeSession(req),
      ...parsed,
    }));
  }));

  app.get('/api/v1/project-registration-drafts/:draftId', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'read a project registration draft');
    const current = await routeContext(req, piiProtector);
    res.status(200).json(await projectRegistrationDraftService.get({
      ...current,
      draftId: routeDraftId(req),
    }));
  }));

  app.patch('/api/v1/project-registration-drafts/:draftId', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'save a project registration draft');
    const parsed = parseWithSchema(projectRegistrationDraftPatchSchema, req.body);
    const current = await routeContext(req, piiProtector);
    sendOutcome(res, await projectRegistrationDraftService.update({
      ...current,
      ...routeOwnership(req),
      draftId: routeDraftId(req),
      ...parsed,
    }));
  }));

  app.post('/api/v1/project-registration-drafts/:draftId/attachments', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'attach a project registration draft file');
    const parsed = parseWithSchema(projectRegistrationDraftAttachmentSchema, req.body);
    const current = await routeContext(req, piiProtector);
    sendOutcome(res, await projectRegistrationDraftService.addAttachment({
      ...current,
      ...routeOwnership(req),
      draftId: routeDraftId(req),
      ...parsed,
      buffer: decodeBase64(parsed.contentBase64, parsed.fileSize),
    }));
  }));
}
