import {
  asyncHandler,
  createHttpError,
  encryptAuditEmail,
  readOptionalText,
} from '../bff-utils.mjs';

const RESOURCE_TYPES = new Set(['project-registration', 'project-info', 'cashflow']);

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

async function serviceInput(req, resource, sessionId, piiProtector) {
  const actorEmailEnc = piiProtector
    ? await encryptAuditEmail(piiProtector, req.context?.actorEmail)
    : undefined;
  return {
    tenantId: readOptionalText(req.context?.tenantId),
    ...resource,
    actorId: readOptionalText(req.context?.actorId),
    actorDisplayName: readOptionalText(req.context?.actorName) || '사용자',
    actorEmailEnc,
    requestId: readOptionalText(req.context?.requestId),
    idempotencyKey: readOptionalText(req.context?.idempotencyKey),
    sessionId,
  };
}

function sendCommandOutcome(res, outcome) {
  const isAtomicOutcome = outcome
    && typeof outcome === 'object'
    && Object.hasOwn(outcome, 'body')
    && typeof outcome.replayed === 'boolean';
  const status = isAtomicOutcome && Number.isInteger(outcome.status) ? outcome.status : 200;
  const body = isAtomicOutcome ? outcome.body : outcome;
  if (isAtomicOutcome && outcome.replayed) res.setHeader('x-idempotency-replayed', '1');
  res.status(status).json(body);
}

export function mountEditLeaseRoutes(app, {
  enabled = false,
  editLeaseService,
  piiProtector,
} = {}) {
  if (!enabled) return;
  if (!editLeaseService) throw new Error('Edit lease routes require the edit lease service');

  app.get('/api/v1/edit-leases/:resourceType/:resourceId', asyncHandler(async (req, res) => {
    const resource = readResource(req);
    const sessionId = readSession(req);
    const input = await serviceInput(req, resource, sessionId, piiProtector);
    const result = await editLeaseService.getStatus(input);
    res.status(200).json(result);
  }));

  app.post('/api/v1/edit-leases/:resourceType/:resourceId/acquire', asyncHandler(async (req, res) => {
    const resource = readResource(req);
    const sessionId = readSession(req);
    const input = await serviceInput(req, resource, sessionId, piiProtector);
    sendCommandOutcome(res, await editLeaseService.acquire(input));
  }));

  for (const operation of ['extend', 'release']) {
    app.post(`/api/v1/edit-leases/:resourceType/:resourceId/${operation}`, asyncHandler(async (req, res) => {
      const resource = readResource(req);
      const ownership = readOwnership(req);
      const input = await serviceInput(req, resource, ownership.sessionId, piiProtector);
      sendCommandOutcome(res, await editLeaseService[operation]({ ...input, ...ownership }));
    }));
  }
}
