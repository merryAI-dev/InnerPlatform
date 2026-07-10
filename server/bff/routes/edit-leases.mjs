import { actorHasPermission } from '../rbac-policy.mjs';
import {
  asyncHandler,
  createHttpError,
  encryptAuditEmail,
  normalizeRole,
  readOptionalText,
} from '../bff-utils.mjs';
import { resolveEditLeaseDocumentId } from '../edit-lease.mjs';
import { sha256 } from '../utils.mjs';

const RESOURCE_TYPES = new Set(['project-registration', 'project-info', 'cashflow']);
const CROSS_PROJECT_ROLES = new Set(['admin', 'finance']);

function readResource(req) {
  const resourceType = readOptionalText(req.params?.resourceType);
  const resourceId = readOptionalText(req.params?.resourceId);
  if (!RESOURCE_TYPES.has(resourceType) || !resourceId || resourceId.includes('/') || resourceId.length > 512) {
    throw createHttpError(400, 'Unsupported edit lease resource', 'edit_lease_resource_invalid');
  }
  return { resourceType, resourceId };
}

function requireHeader(req, name) {
  const value = readOptionalText(req.header(name));
  if (!value) throw createHttpError(400, `${name} header is required`, 'edit_lease_request_invalid');
  return value;
}

function readSession(req) {
  return requireHeader(req, 'x-edit-session-id');
}

function readOwnership(req) {
  const sessionId = readSession(req);
  const leaseId = requireHeader(req, 'x-edit-lease-id');
  const rawFence = requireHeader(req, 'x-edit-fence');
  if (!/^[1-9]\d*$/.test(rawFence)) {
    throw createHttpError(400, 'x-edit-fence must be a positive integer', 'edit_lease_request_invalid');
  }
  const fence = Number(rawFence);
  if (!Number.isSafeInteger(fence)) {
    throw createHttpError(400, 'x-edit-fence must be a safe integer', 'edit_lease_request_invalid');
  }
  return { sessionId, leaseId, fence };
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

async function assertResourceAccess({ db, rbacPolicy, req, resourceType, resourceId }) {
  const { tenantId, actorId } = req.context || {};
  if (resourceType === 'project-registration') {
    const draftSnap = await db.doc(`orgs/${tenantId}/projectRequestDrafts/${resourceId}`).get();
    const draft = draftSnap.exists ? (draftSnap.data() || {}) : {};
    const ownerId = readOptionalText(draft.ownerUid) || readOptionalText(draft.ownerId);
    if (!draftSnap.exists || ownerId !== readOptionalText(actorId)) {
      throw createHttpError(404, 'Project registration draft not found', 'not_found');
    }
    return;
  }

  const projectSnap = await db.doc(`orgs/${tenantId}/projects/${resourceId}`).get();
  if (!projectSnap.exists) throw createHttpError(404, 'Project not found', 'not_found');

  const actorRole = normalizeRole(req.context?.actorRole);
  if (!actorHasPermission(rbacPolicy, { actorRole, permission: 'project:write' })) {
    throw createHttpError(403, 'Project write access is required', 'forbidden');
  }
  if (CROSS_PROJECT_ROLES.has(actorRole)) return;

  const memberSnap = await db.doc(`orgs/${tenantId}/members/${actorId}`).get();
  const member = memberSnap.exists ? (memberSnap.data() || {}) : {};
  const memberStatus = readOptionalText(member.status).toUpperCase();
  const memberUid = readOptionalText(member.uid);
  if (
    (memberStatus && memberStatus !== 'ACTIVE')
    || (memberUid && memberUid !== readOptionalText(actorId))
    || !memberProjectIds(member).has(resourceId)
  ) {
    throw createHttpError(403, 'Project assignment is required', 'forbidden');
  }
}

function serviceInput(req, resource, sessionId) {
  return {
    tenantId: readOptionalText(req.context?.tenantId),
    ...resource,
    actorId: readOptionalText(req.context?.actorId),
    actorDisplayName: readOptionalText(req.context?.actorName) || '사용자',
    sessionId,
  };
}

async function appendAudit({
  auditChainService,
  piiProtector,
  req,
  resource,
  operation,
  result,
  sessionId,
  fence,
  resultCode,
}) {
  if (!auditChainService || typeof auditChainService.append !== 'function') return;
  const actorEmailEnc = piiProtector
    ? await encryptAuditEmail(piiProtector, req.context?.actorEmail)
    : undefined;
  const entry = {
    tenantId: req.context.tenantId,
    entityType: 'edit_lease',
    entityId: resolveEditLeaseDocumentId(resource.resourceType, resource.resourceId),
    action: `EDIT_LEASE_${operation.toUpperCase()}`,
    actorId: req.context.actorId,
    actorRole: req.context.actorRole,
    actorEmailEnc,
    requestId: req.context.requestId,
    details: `Edit lease ${operation}: ${resource.resourceType}`,
    metadata: {
      source: 'bff',
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      sessionIdHash: sha256(`${req.context.tenantId}:${sessionId}`),
      fence: Number.isSafeInteger(Number(fence)) && Number(fence) > 0 ? Number(fence) : null,
      state: result.state,
      resultCode,
    },
    ...(result.serverNow ? { timestamp: result.serverNow } : {}),
  };
  await auditChainService.append(entry);
}

async function auditKnownLeaseError(options, error) {
  const operation = error?.code === 'edit_lease_held'
    ? 'conflict'
    : (error?.code === 'edit_lease_expired' ? 'expire' : '');
  if (!operation) return;
  await appendAudit({
    ...options,
    operation,
    result: {
      state: operation === 'expire' ? 'EXPIRED' : 'ACTIVE',
      serverNow: error.auditContext?.serverNow,
    },
    fence: error.auditContext?.fence,
    resultCode: error.code,
  });
}

export function mountEditLeaseRoutes(app, {
  enabled = false,
  db,
  editLeaseService,
  rbacPolicy,
  auditChainService,
  piiProtector,
} = {}) {
  if (!enabled) return;
  if (!db || !editLeaseService || !rbacPolicy) {
    throw new Error('Edit lease routes require Firestore, service, and RBAC policy');
  }

  app.get('/api/v1/edit-leases/:resourceType/:resourceId', asyncHandler(async (req, res) => {
    const resource = readResource(req);
    const sessionId = readSession(req);
    await assertResourceAccess({ db, rbacPolicy, req, ...resource });
    const rawResult = await editLeaseService.getStatus(serviceInput(req, resource, sessionId));
    const { audit, ...result } = rawResult;
    if (result.state === 'EXPIRED') {
      await appendAudit({
        auditChainService,
        piiProtector,
        req,
        resource,
        operation: 'expire',
        result,
        sessionId,
        fence: audit?.fence,
        resultCode: 'edit_lease_expired',
      });
    }
    res.status(200).json(result);
  }));

  app.post('/api/v1/edit-leases/:resourceType/:resourceId/acquire', asyncHandler(async (req, res) => {
    const resource = readResource(req);
    const sessionId = readSession(req);
    await assertResourceAccess({ db, rbacPolicy, req, ...resource });
    const auditOptions = { auditChainService, piiProtector, req, resource, sessionId };
    try {
      const result = await editLeaseService.acquire(serviceInput(req, resource, sessionId));
      await appendAudit({
        ...auditOptions,
        operation: 'acquire',
        result,
        fence: result.fence,
        resultCode: 'edit_lease_acquired',
      });
      res.status(200).json(result);
    } catch (error) {
      await auditKnownLeaseError(auditOptions, error);
      throw error;
    }
  }));

  for (const operation of ['extend', 'release']) {
    app.post(`/api/v1/edit-leases/:resourceType/:resourceId/${operation}`, asyncHandler(async (req, res) => {
      const resource = readResource(req);
      const ownership = readOwnership(req);
      await assertResourceAccess({ db, rbacPolicy, req, ...resource });
      const auditOptions = {
        auditChainService,
        piiProtector,
        req,
        resource,
        sessionId: ownership.sessionId,
      };
      try {
        const result = await editLeaseService[operation]({
          ...serviceInput(req, resource, ownership.sessionId),
          leaseId: ownership.leaseId,
          fence: ownership.fence,
        });
        await appendAudit({
          ...auditOptions,
          operation,
          result,
          fence: ownership.fence,
          resultCode: `edit_lease_${operation === 'extend' ? 'extended' : 'released'}`,
        });
        res.status(200).json(result);
      } catch (error) {
        await auditKnownLeaseError(auditOptions, error);
        throw error;
      }
    }));
  }
}
