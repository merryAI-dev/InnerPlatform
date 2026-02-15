import express from 'express';
import { randomUUID } from 'node:crypto';
import { createFirestoreDb, isFirestoreEmulatorEnabled, resolveProjectId } from './firestore.mjs';
import {
  createFirebaseTokenVerifier,
  resolveAuthMode,
  resolveRequestIdentity,
} from './auth.mjs';
import { createIdempotencyService } from './idempotency.mjs';
import { createAuditChainService } from './audit-chain.mjs';
import {
  createOutboxEvent,
  enqueueOutboxEventInTransaction,
  processOutboxBatch,
} from './outbox.mjs';
import {
  createWorkQueueJob,
  enqueueReplayJobs,
  enqueueWorkQueueJobsInTransaction,
  processWorkQueueBatch,
} from './work-queue.mjs';
import {
  listSupportedViews,
} from './projections.mjs';
import {
  runMonthlyCloseWorker,
  runPayrollWorker,
} from './payroll-worker.mjs';
import {
  resolveAffectedViews,
  resolveRelationRules,
  resolveRelationRulesPolicyPath,
} from './relation-rules.mjs';
import { createPiiProtector } from './pii-protection.mjs';
import { actorHasPermission, canActorAssignRole, loadRbacPolicy } from './rbac-policy.mjs';
import {
  createRequestId,
} from './utils.mjs';
import {
  commentCreateSchema,
  evidenceCreateSchema,
  genericWriteSchema,
  ledgerUpsertSchema,
  memberRoleUpdateSchema,
  parseWithSchema,
  projectUpsertSchema,
  transactionStateSchema,
  transactionUpsertSchema,
} from './schemas.mjs';
import {
  assertTransitionAllowed,
  normalizeState,
} from './state-policy.mjs';

function createHttpError(statusCode, message, code = 'request_error') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseLimit(raw, fallback = 50, max = 200) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseCursor(raw) {
  const cursor = typeof raw === 'string' ? raw.trim() : '';
  return cursor || undefined;
}

function parseBearerToken(rawAuthorization) {
  const value = typeof rawAuthorization === 'string' ? rawAuthorization.trim() : '';
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAllowedOrigins(value) {
  const rawValue = String(value || '');
  const parsed = rawValue
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parsed.length > 0) {
    return parsed;
  }

  return ['http://127.0.0.1:5173', 'http://localhost:5173'];
}

function buildListResponse(items, limit) {
  const nextCursor = items.length === limit ? items[items.length - 1]?.id || null : null;
  return {
    items,
    count: items.length,
    nextCursor,
  };
}

function normalizeEntityType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const ENTITY_COLLECTIONS = {
  project: 'projects',
  ledger: 'ledgers',
  transaction: 'transactions',
  expense_set: 'expense_sets',
  expense_sets: 'expense_sets',
  change_request: 'change_requests',
  change_requests: 'change_requests',
  member: 'members',
};

function resolveEntityCollectionName(entityType) {
  const normalized = normalizeEntityType(entityType);
  return ENTITY_COLLECTIONS[normalized] || '';
}

function resolveEntityDocPath(tenantId, entityType, entityId) {
  const collectionName = resolveEntityCollectionName(entityType);
  if (!collectionName) {
    throw createHttpError(400, `Unsupported entityType: ${entityType}`);
  }
  const normalizedId = typeof entityId === 'string' ? entityId.trim() : '';
  if (!normalizedId) {
    throw createHttpError(400, 'entityId is required');
  }
  return `orgs/${tenantId}/${collectionName}/${normalizedId}`;
}

function flattenObjectPaths(value, basePath = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return basePath ? [basePath] : [];
  }

  const keys = Object.keys(value);
  if (!keys.length) {
    return basePath ? [basePath] : [];
  }

  const paths = [];
  for (const key of keys) {
    const nextPath = basePath ? `${basePath}.${key}` : key;
    const nextValue = value[key];
    if (nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)) {
      paths.push(...flattenObjectPaths(nextValue, nextPath));
    } else {
      paths.push(nextPath);
    }
  }
  return paths;
}

function readByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return acc[key];
  }, obj);
}

function detectChangedFields(current, patch) {
  const paths = flattenObjectPaths(patch);
  return paths.filter((path) => {
    const before = readByPath(current, path);
    const after = readByPath(patch, path);
    return JSON.stringify(before) !== JSON.stringify(after);
  });
}

function stripExpectedVersion(payload) {
  const cloned = { ...payload };
  delete cloned.expectedVersion;
  return cloned;
}

const SERVER_MANAGED_FIELDS = new Set([
  'tenantId',
  'version',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt',
  'submittedBy',
  'submittedAt',
  'approvedBy',
  'approvedAt',
  'rejectedReason',
  'uploadedBy',
  'uploadedAt',
  'authorId',
]);

function stripServerManagedFields(payload) {
  const sanitized = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (SERVER_MANAGED_FIELDS.has(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function assertReasonForRejected(state, reason) {
  if (state === 'REJECTED' && (!reason || !reason.trim())) {
    throw createHttpError(400, 'REJECTED transition requires a rejection reason');
  }
}

function normalizeRole(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const ROUTE_ROLES = {
  readCore: ['admin', 'finance', 'pm', 'viewer', 'auditor', 'tenant_admin', 'support', 'security'],
  writeCore: ['admin', 'finance', 'pm', 'tenant_admin'],
  writeTransaction: ['admin', 'finance', 'pm', 'tenant_admin'],
  auditRead: ['admin', 'finance', 'auditor', 'tenant_admin', 'support', 'security'],
  memberWrite: ['admin', 'tenant_admin'],
};

async function encryptAuditEmail(piiProtector, email) {
  if (!email) return undefined;
  const encrypted = await piiProtector.encryptText(email);
  return encrypted?.ciphertext || undefined;
}

async function ensureDocumentExists(db, path, notFoundMessage) {
  const snap = await db.doc(path).get();
  if (!snap.exists) {
    throw createHttpError(404, notFoundMessage, 'not_found');
  }
  return snap.data();
}

async function upsertVersionedDoc({
  db,
  path,
  payload,
  tenantId,
  actorId,
  now,
  expectedVersion,
  outboxEvent,
}) {
  const ref = db.doc(path);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      if (expectedVersion !== undefined && expectedVersion !== 0) {
        throw createHttpError(409, `Version mismatch: expected ${expectedVersion}, actual 0`, 'version_conflict');
      }

      const nextVersion = 1;
      const document = {
        ...payload,
        tenantId,
        version: nextVersion,
        createdBy: actorId,
        createdAt: now,
        updatedBy: actorId,
        updatedAt: now,
      };

      tx.set(ref, document, { merge: true });
      if (outboxEvent) {
        enqueueOutboxEventInTransaction(tx, db, outboxEvent);
      }
      return { created: true, version: nextVersion, data: document };
    }

    const current = snap.data() || {};
    const currentVersion = Number.isInteger(current.version) && current.version > 0 ? current.version : 1;

    if (expectedVersion === undefined) {
      throw createHttpError(409, `expectedVersion is required for update (current=${currentVersion})`, 'version_required');
    }

    if (expectedVersion !== currentVersion) {
      throw createHttpError(
        409,
        `Version mismatch: expected ${expectedVersion}, actual ${currentVersion}`,
        'version_conflict',
      );
    }

    const nextVersion = currentVersion + 1;
    const document = {
      ...current,
      ...payload,
      tenantId,
      version: nextVersion,
      createdBy: current.createdBy || actorId,
      createdAt: current.createdAt || now,
      updatedBy: actorId,
      updatedAt: now,
    };

    tx.set(ref, document, { merge: true });
    if (outboxEvent) {
      enqueueOutboxEventInTransaction(tx, db, outboxEvent);
    }
    return { created: false, version: nextVersion, data: document };
  });
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function assertActorRoleAllowed(req, allowedRoles, action) {
  const actorRole = normalizeRole(req.context?.actorRole);
  if (!actorRole || !allowedRoles.includes(actorRole)) {
    throw createHttpError(
      403,
      `Role '${actorRole || 'unknown'}' is not allowed to ${action}`,
      'forbidden',
    );
  }
}

function assertActorPermissionAllowed(policy, req, requiredPermission, action) {
  const actorRole = normalizeRole(req.context?.actorRole);
  if (!actorRole || !actorHasPermission(policy, { actorRole, permission: requiredPermission })) {
    throw createHttpError(
      403,
      `Role '${actorRole || 'unknown'}' lacks permission '${requiredPermission}' to ${action}`,
      'forbidden',
    );
  }
}

function createApiContextMiddleware({ authMode, verifyToken }) {
  return asyncHandler(async (req, res, next) => {
    const requestId = req.header('x-request-id') || createRequestId();
    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    const idempotencyKey = req.header('idempotency-key') || '';

    if (isMutating && !idempotencyKey.trim()) {
      throw createHttpError(400, 'idempotency-key header is required for mutating requests');
    }

    const identity = await resolveRequestIdentity({
      authMode,
      verifyToken,
      readHeaderValue: (name) => req.header(name),
    });

    req.context = {
      tenantId: identity.tenantId,
      actorId: identity.actorId,
      actorRole: identity.actorRole,
      actorEmail: identity.actorEmail,
      authSource: identity.source,
      requestId,
      idempotencyKey: idempotencyKey.trim() || undefined,
    };

    res.setHeader('x-request-id', requestId);
    next();
  });
}

function createMutatingRoute(idempotencyService, routeHandler) {
  return asyncHandler(async (req, res) => {
    const { tenantId, idempotencyKey, actorId, requestId } = req.context;

    const lock = await idempotencyService.begin({
      tenantId,
      idempotencyKey,
      method: req.method,
      path: req.path,
      body: req.body,
      actorId,
      requestId,
    });

    if (lock.mode === 'replay') {
      res.setHeader('x-idempotency-replayed', '1');
      res.status(lock.status).json(lock.body);
      return;
    }

    if (lock.mode === 'conflict') {
      res.status(409).json({ error: 'idempotency_conflict', message: lock.reason });
      return;
    }

    if (lock.mode === 'in_progress') {
      res.status(409).json({ error: 'idempotency_in_progress', message: lock.reason });
      return;
    }

    try {
      const result = await routeHandler(req, res);
      const status = result?.status ?? 200;
      const body = result?.body ?? null;

      await idempotencyService.complete({
        tenantId,
        idempotencyKey,
        requestFingerprint: lock.requestFingerprint,
        responseStatus: status,
        responseBody: body,
        requestId,
      });

      res.status(status).json(body);
    } catch (error) {
      await idempotencyService.fail({
        tenantId,
        idempotencyKey,
        requestFingerprint: lock.requestFingerprint,
        requestId,
        error,
      });
      throw error;
    }
  });
}

export function createBffApp(options = {}) {
  const app = express();
  const now = options.now || (() => new Date().toISOString());
  const projectId = options.projectId || resolveProjectId();
  const db = options.db || createFirestoreDb({ projectId });
  const authMode = options.authMode || resolveAuthMode();
  const verifyToken = options.tokenVerifier || createFirebaseTokenVerifier({ projectId });
  const idempotencyService = createIdempotencyService(db);
  const auditChainService = createAuditChainService(db, { now });
  const piiProtector = options.piiProtector || createPiiProtector();
  const rbacPolicy = options.rbacPolicy || loadRbacPolicy();
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins || process.env.BFF_ALLOWED_ORIGINS);
  const relationRulesPolicyPath = options.relationRulesPolicyPath || resolveRelationRulesPolicyPath();
  const workQueueBatchSizeRaw = Number.parseInt(process.env.BFF_WORK_QUEUE_BATCH || '100', 10);
  const workQueueMaxAttemptsRaw = Number.parseInt(process.env.BFF_WORK_QUEUE_MAX_ATTEMPTS || '6', 10);
  const outboxBatchSizeRaw = Number.parseInt(process.env.BFF_OUTBOX_BATCH || '50', 10);
  const outboxMaxAttemptsRaw = Number.parseInt(process.env.BFF_OUTBOX_MAX_ATTEMPTS || '8', 10);
  const workQueueBatchSize = Number.isFinite(workQueueBatchSizeRaw) && workQueueBatchSizeRaw > 0 ? workQueueBatchSizeRaw : 100;
  const workQueueMaxAttempts = Number.isFinite(workQueueMaxAttemptsRaw) && workQueueMaxAttemptsRaw > 0 ? workQueueMaxAttemptsRaw : 6;
  const outboxBatchSize = Number.isFinite(outboxBatchSizeRaw) && outboxBatchSizeRaw > 0 ? outboxBatchSizeRaw : 50;
  const outboxMaxAttempts = Number.isFinite(outboxMaxAttemptsRaw) && outboxMaxAttemptsRaw > 0 ? outboxMaxAttemptsRaw : 8;
  const workerSecret = readOptionalText(options.workerSecret || process.env.BFF_WORKER_SECRET || process.env.CRON_SECRET);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const requestOrigin = req.header('origin') || '';
    const allowAnyOrigin = allowedOrigins.includes('*');
    const isAllowedOrigin = allowAnyOrigin || !requestOrigin || allowedOrigins.includes(requestOrigin);

    if (!isAllowedOrigin) {
      res.status(403).json({
        error: 'origin_not_allowed',
        message: `Origin is not allowed: ${requestOrigin}`,
      });
      return;
    }

    if (requestOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowAnyOrigin ? '*' : requestOrigin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-tenant-id, x-actor-id, x-actor-role, x-actor-email, x-request-id, idempotency-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');

    if (req.method.toUpperCase() === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    const requestId = req.header('x-request-id') || createRequestId();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const statusCode = res.statusCode || 0;
      const payload = {
        severity: statusCode >= 500 ? 'ERROR' : (statusCode >= 400 ? 'WARNING' : 'INFO'),
        message: 'bff.request',
        service: 'mysc-bff',
        method: req.method,
        path: req.path,
        statusCode,
        latencyMs: durationMs,
        requestId: req.requestId || req.context?.requestId,
        tenantId: req.context?.tenantId || null,
        actorId: req.context?.actorId || null,
        errorCode: res.locals.errorCode || null,
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(payload));
    });
    next();
  });

  async function loadTenantRules(tenantId) {
    return resolveRelationRules({
      db,
      tenantId,
      policyPath: relationRulesPolicyPath,
    });
  }

  async function processQueueSync(tenantId, eventId) {
    return processWorkQueueBatch(db, {
      tenantId,
      eventId,
      limit: workQueueBatchSize,
      maxAttempts: workQueueMaxAttempts,
      now,
    });
  }

  function assertInternalWorkerAuthorized(req) {
    if (!workerSecret) {
      throw createHttpError(503, 'Worker secret is not configured', 'worker_secret_missing');
    }
    const headerSecret = readOptionalText(req.header('x-worker-secret'));
    const bearerSecret = parseBearerToken(req.header('authorization'));
    const matched = (headerSecret && headerSecret === workerSecret)
      || (bearerSecret && bearerSecret === workerSecret);
    if (!matched) {
      throw createHttpError(401, 'Worker authorization failed', 'unauthorized_worker');
    }
  }

  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'mysc-bff',
      projectId,
      authMode,
      firestoreEmulator: isFirestoreEmulatorEnabled(),
      timestamp: now(),
    });
  });

  const runOutboxWorker = asyncHandler(async (req, res) => {
    assertInternalWorkerAuthorized(req);
    const limit = parseLimit(req.body?.limit ?? req.query?.limit, outboxBatchSize, 500);
    const maxAttempts = parseLimit(req.body?.maxAttempts ?? req.query?.maxAttempts, outboxMaxAttempts, 50);

    const result = await processOutboxBatch(db, {
      limit,
      maxAttempts,
      now,
    });

    res.status(200).json({
      ok: true,
      worker: 'outbox',
      projectId,
      ...result,
    });
  });
  // Vercel Cron runs internal worker endpoints via GET.
  app.get('/api/internal/workers/outbox/run', runOutboxWorker);
  app.post('/api/internal/workers/outbox/run', runOutboxWorker);

  const runWorkQueueWorker = asyncHandler(async (req, res) => {
    assertInternalWorkerAuthorized(req);
    const limit = parseLimit(req.body?.limit ?? req.query?.limit, workQueueBatchSize, 500);
    const maxAttempts = parseLimit(req.body?.maxAttempts ?? req.query?.maxAttempts, workQueueMaxAttempts, 50);
    const tenantId = readOptionalText(req.body?.tenantId ?? req.query?.tenantId) || undefined;
    const eventId = readOptionalText(req.body?.eventId ?? req.query?.eventId) || undefined;

    const result = await processWorkQueueBatch(db, {
      tenantId,
      eventId,
      limit,
      maxAttempts,
      now,
    });

    res.status(200).json({
      ok: true,
      worker: 'work_queue',
      projectId,
      tenantId: tenantId || null,
      eventId: eventId || null,
      ...result,
    });
  });
  // Vercel Cron runs internal worker endpoints via GET.
  app.get('/api/internal/workers/work-queue/run', runWorkQueueWorker);
  app.post('/api/internal/workers/work-queue/run', runWorkQueueWorker);

  const runPayrollWorkerRoute = asyncHandler(async (req, res) => {
    assertInternalWorkerAuthorized(req);
    const tenantId = readOptionalText(req.body?.tenantId ?? req.query?.tenantId) || undefined;
    const monthsAheadRaw = Number.parseInt(String(req.body?.monthsAhead ?? req.query?.monthsAhead ?? '1'), 10);
    const leadDaysRaw = Number.parseInt(String(req.body?.leadBusinessDays ?? req.query?.leadBusinessDays ?? '3'), 10);
    const matchWindowRaw = Number.parseInt(String(req.body?.matchWindowDays ?? req.query?.matchWindowDays ?? '2'), 10);
    const monthsAhead = Number.isFinite(monthsAheadRaw) && monthsAheadRaw >= 0 && monthsAheadRaw <= 6 ? monthsAheadRaw : 1;
    const leadBusinessDays = Number.isFinite(leadDaysRaw) && leadDaysRaw >= 0 && leadDaysRaw <= 10 ? leadDaysRaw : 3;
    const matchWindowDays = Number.isFinite(matchWindowRaw) && matchWindowRaw >= 0 && matchWindowRaw <= 10 ? matchWindowRaw : 2;

    const result = await runPayrollWorker(db, {
      tenantId,
      nowIso: now(),
      monthsAhead,
      leadBusinessDays,
      matchWindowDays,
    });

    res.status(200).json({
      ok: true,
      worker: 'payroll',
      projectId,
      ...result,
    });
  });
  app.get('/api/internal/workers/payroll/run', runPayrollWorkerRoute);
  app.post('/api/internal/workers/payroll/run', runPayrollWorkerRoute);

  const runMonthlyCloseWorkerRoute = asyncHandler(async (req, res) => {
    assertInternalWorkerAuthorized(req);
    const tenantId = readOptionalText(req.body?.tenantId ?? req.query?.tenantId) || undefined;
    const createMonthsRaw = Number.parseInt(String(req.body?.createMonths ?? req.query?.createMonths ?? '2'), 10);
    const createMonths = Number.isFinite(createMonthsRaw) && createMonthsRaw >= 1 && createMonthsRaw <= 6 ? createMonthsRaw : 2;

    const result = await runMonthlyCloseWorker(db, {
      tenantId,
      nowIso: now(),
      createMonths,
    });

    res.status(200).json({
      ok: true,
      worker: 'monthly_close',
      projectId,
      ...result,
    });
  });
  app.get('/api/internal/workers/monthly-close/run', runMonthlyCloseWorkerRoute);
  app.post('/api/internal/workers/monthly-close/run', runMonthlyCloseWorkerRoute);

  app.use('/api/v1', createApiContextMiddleware({ authMode, verifyToken }));

  app.post('/api/v1/write', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write data');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(genericWriteSchema, req.body, 'Invalid write payload');

    const entityType = normalizeEntityType(parsed.entityType);
    const payloadPatch = stripServerManagedFields(parsed.patch || {});
    const patchId = typeof payloadPatch.id === 'string' ? payloadPatch.id.trim() : '';
    const bodyEntityId = typeof parsed.entityId === 'string' ? parsed.entityId.trim() : '';
    const entityId = bodyEntityId || patchId;

    if (!entityId) {
      throw createHttpError(400, 'entityId is required (either entityId or patch.id)');
    }
    if (bodyEntityId && patchId && bodyEntityId !== patchId) {
      throw createHttpError(400, 'entityId and patch.id do not match');
    }

    payloadPatch.id = entityId;
    const docPath = resolveEntityDocPath(tenantId, entityType, entityId);
    const rules = await loadTenantRules(tenantId);
    const eventId = `ce_${timestamp.replace(/[^0-9]/g, '').slice(0, 14)}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

    const result = await db.runTransaction(async (tx) => {
      const ref = db.doc(docPath);
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data() || {}) : {};
      const currentVersion = Number.isInteger(current.version) && current.version > 0 ? current.version : 0;
      const expectedVersion = parsed.expectedVersion;

      if (!snap.exists) {
        if (expectedVersion !== undefined && expectedVersion !== 0) {
          throw createHttpError(
            409,
            `Version mismatch: expected ${expectedVersion}, actual 0`,
            'version_conflict',
          );
        }
      } else {
        if (expectedVersion === undefined) {
          throw createHttpError(
            409,
            `expectedVersion is required for update (current=${currentVersion})`,
            'version_required',
          );
        }
        if (expectedVersion !== currentVersion) {
          throw createHttpError(
            409,
            `Version mismatch: expected ${expectedVersion}, actual ${currentVersion}`,
            'version_conflict',
          );
        }
      }

      const changedFields = detectChangedFields(current, payloadPatch);
      const nextVersion = currentVersion + 1;
      const document = {
        ...current,
        ...payloadPatch,
        id: entityId,
        tenantId,
        version: nextVersion,
        createdBy: current.createdBy || actorId,
        createdAt: current.createdAt || timestamp,
        updatedBy: actorId,
        updatedAt: timestamp,
      };
      tx.set(ref, document, { merge: true });

      const changeEvent = {
        id: eventId,
        tenantId,
        requestId,
        entityType,
        entityId,
        version: nextVersion,
        changedFields,
        actorId,
        actorRole: actorRole || null,
        actorEmail: actorEmail || null,
        createdAt: timestamp,
      };
      tx.set(db.doc(`orgs/${tenantId}/change_events/${eventId}`), changeEvent, { merge: true });

      const affectedViews = resolveAffectedViews(rules, {
        entityType,
        changedFields,
      });
      const jobs = affectedViews.map((viewName) => createWorkQueueJob({
        tenantId,
        eventId,
        entityType,
        entityId,
        viewName,
        dedupeKey: `${tenantId}:${entityType}:${entityId}:${nextVersion}:${viewName}`,
        payload: {
          changedFields,
          version: nextVersion,
        },
        createdAt: timestamp,
      }));
      enqueueWorkQueueJobsInTransaction(tx, db, jobs);

      return {
        created: !snap.exists,
        version: nextVersion,
        changedFields,
        affectedViews,
      };
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType,
      entityId,
      action: result.created ? 'CREATE' : 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `Generic write: ${entityType}/${entityId}`,
      metadata: {
        source: 'bff.write',
        version: result.version,
        changedFields: result.changedFields,
        affectedViews: result.affectedViews,
        eventId,
      },
      timestamp,
    });

    let queueResult = null;
    const syncEnabled = parsed.options?.sync !== false;
    if (syncEnabled && result.affectedViews.length) {
      queueResult = await processQueueSync(tenantId, eventId);
    }

    return {
      status: result.created ? 201 : 200,
      body: {
        eventId,
        tenantId,
        entityType,
        entityId,
        version: result.version,
        changedFields: result.changedFields,
        affectedViews: result.affectedViews,
        queue: queueResult,
      },
    };
  }));

  app.get('/api/v1/views/:viewName', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read projection views');
    const viewName = normalizeEntityType(req.params.viewName);
    const supported = listSupportedViews();
    if (!supported.includes(viewName)) {
      throw createHttpError(404, `Unsupported view: ${viewName}`, 'not_found');
    }

    const snap = await db.doc(`orgs/${tenantId}/views/${viewName}`).get();
    const data = snap.exists ? (snap.data() || {}) : {
      tenantId,
      view: viewName,
      updatedAt: null,
    };

    if (viewName === 'project_financials' && typeof req.query.projectId === 'string') {
      const projects = Array.isArray(data.projects) ? data.projects : [];
      const projectId = req.query.projectId.trim();
      const item = projects.find((project) => project.projectId === projectId) || null;
      res.status(200).json({
        view: viewName,
        projectId,
        item,
        updatedAt: data.updatedAt || null,
      });
      return;
    }

    if (viewName === 'member_workload' && typeof req.query.memberId === 'string') {
      const members = Array.isArray(data.members) ? data.members : [];
      const memberId = req.query.memberId.trim();
      const item = members.find((member) => member.memberId === memberId) || null;
      res.status(200).json({
        view: viewName,
        memberId,
        item,
        updatedAt: data.updatedAt || null,
      });
      return;
    }

    res.status(200).json(data);
  }));

  app.get('/api/v1/queue/jobs', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.auditRead, 'read queue jobs');
    const limit = parseLimit(req.query.limit, 50, 200);
    const statusFilter = typeof req.query.status === 'string'
      ? req.query.status.trim().toUpperCase()
      : '';
    const eventIdFilter = typeof req.query.eventId === 'string' ? req.query.eventId.trim() : '';

    const scanLimit = Math.max(limit * 6, 200);
    const snap = await db.collection('work_queue').limit(scanLimit).get();
    const items = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => item.tenantId === tenantId)
      .filter((item) => (statusFilter ? String(item.status || '').toUpperCase() === statusFilter : true))
      .filter((item) => (eventIdFilter ? item.eventId === eventIdFilter : true))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit);

    res.status(200).json({
      items,
      count: items.length,
    });
  }));

  app.post('/api/v1/queue/replay/:eventId', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'replay queue event');
    const { tenantId } = req.context;
    const eventId = req.params.eventId;
    const timestamp = now();

    const eventSnap = await db.doc(`orgs/${tenantId}/change_events/${eventId}`).get();
    if (!eventSnap.exists) {
      throw createHttpError(404, `Change event not found: ${eventId}`, 'not_found');
    }

    const event = eventSnap.data() || {};
    const rules = await loadTenantRules(tenantId);
    const affectedViews = resolveAffectedViews(rules, {
      entityType: event.entityType,
      changedFields: Array.isArray(event.changedFields) ? event.changedFields : [],
    });

    const replayViews = affectedViews.length ? affectedViews : ['alerts'];
    const jobs = await enqueueReplayJobs(db, {
      tenantId,
      eventId,
      entityType: event.entityType,
      entityId: event.entityId,
      views: replayViews,
      createdAt: timestamp,
    });

    const queueResult = await processQueueSync(tenantId, eventId);
    return {
      status: 200,
      body: {
        eventId,
        queued: jobs.length,
        affectedViews: replayViews,
        queue: queueResult,
      },
    };
  }));

  app.get('/api/v1/projects', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read projects');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);

    let query = db.collection(`orgs/${tenantId}/projects`).orderBy('__name__').limit(limit);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  app.get('/api/v1/ledgers', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read ledgers');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);
    const projectIdFilter = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';

    let query = db.collection(`orgs/${tenantId}/ledgers`);
    if (projectIdFilter) {
      query = query.where('projectId', '==', projectIdFilter);
    }
    query = query.orderBy('__name__').limit(limit);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  app.get('/api/v1/transactions', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read transactions');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);
    const projectIdFilter = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    const ledgerIdFilter = typeof req.query.ledgerId === 'string' ? req.query.ledgerId.trim() : '';

    let query = db.collection(`orgs/${tenantId}/transactions`);
    if (projectIdFilter) query = query.where('projectId', '==', projectIdFilter);
    if (ledgerIdFilter) query = query.where('ledgerId', '==', ledgerIdFilter);
    query = query.orderBy('__name__').limit(limit);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  app.get('/api/v1/transactions/:txId/comments', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read comments');
    assertActorPermissionAllowed(rbacPolicy, req, 'comment:read', 'read comments');
    const { txId } = req.params;
    const limit = parseLimit(req.query.limit, 100, 500);

    await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);

    const snap = await db
      .collection(`orgs/${tenantId}/comments`)
      .where('transactionId', '==', txId)
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .get();

    const items = [];
    for (const doc of snap.docs) {
      const raw = doc.data() || {};
      let authorName = raw.authorName;
      if (typeof raw.authorNameEnc === 'string' && raw.authorNameEnc) {
        authorName = await piiProtector.decryptText(raw.authorNameEnc);
      }
      items.push({
        id: doc.id,
        ...raw,
        authorName: authorName || raw.authorNameMasked || raw.authorId,
      });
    }
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/transactions/:txId/evidences', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read evidences');
    assertActorPermissionAllowed(rbacPolicy, req, 'evidence:read', 'read evidences');
    const { txId } = req.params;
    const limit = parseLimit(req.query.limit, 100, 500);

    await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);

    const snap = await db
      .collection(`orgs/${tenantId}/evidences`)
      .where('transactionId', '==', txId)
      .orderBy('uploadedAt', 'asc')
      .limit(limit)
      .get();

    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/audit-logs', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.auditRead, 'read audit logs');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);

    let query = db.collection(`orgs/${tenantId}/audit_logs`).orderBy('__name__').limit(limit);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  app.get('/api/v1/audit-logs/verify', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.auditRead, 'verify audit logs');
    const limit = parseLimit(req.query.limit, 2000, 10000);
    const result = await auditChainService.verify({ tenantId, limit });
    res.status(result.ok ? 200 : 409).json(result);
  }));

  app.post('/api/v1/projects', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write projects');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(projectUpsertSchema, req.body, 'Invalid project payload');
    const expectedVersion = parsed.expectedVersion;

    const projectPayload = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: parsed.id.trim(),
      name: parsed.name.trim(),
      orgId: tenantId,
    };

    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'project.upsert',
      entityType: 'project',
      entityId: projectPayload.id,
      payload: {
        name: projectPayload.name,
        expectedVersion: expectedVersion ?? null,
      },
      createdAt: timestamp,
    });

    const result = await upsertVersionedDoc({
      db,
      path: `orgs/${tenantId}/projects/${projectPayload.id}`,
      payload: projectPayload,
      tenantId,
      actorId,
      now: timestamp,
      expectedVersion,
      outboxEvent,
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'project',
      entityId: projectPayload.id,
      action: result.created ? 'CREATE' : 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `프로젝트 업데이트: ${projectPayload.name}`,
      metadata: { source: 'bff', version: result.version, outboxId: outboxEvent.id },
      timestamp,
    });

    return {
      status: result.created ? 201 : 200,
      body: {
        id: projectPayload.id,
        tenantId,
        version: result.version,
        updatedAt: result.data.updatedAt,
      },
    };
  }));

  app.post('/api/v1/ledgers', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write ledgers');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(ledgerUpsertSchema, req.body, 'Invalid ledger payload');
    const expectedVersion = parsed.expectedVersion;

    await ensureDocumentExists(
      db,
      `orgs/${tenantId}/projects/${parsed.projectId}`,
      `Project not found: ${parsed.projectId}`,
    );

    const ledgerPayload = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: parsed.id.trim(),
      projectId: parsed.projectId.trim(),
      name: parsed.name.trim(),
    };

    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'ledger.upsert',
      entityType: 'ledger',
      entityId: ledgerPayload.id,
      payload: {
        projectId: ledgerPayload.projectId,
        name: ledgerPayload.name,
        expectedVersion: expectedVersion ?? null,
      },
      createdAt: timestamp,
    });

    const result = await upsertVersionedDoc({
      db,
      path: `orgs/${tenantId}/ledgers/${ledgerPayload.id}`,
      payload: ledgerPayload,
      tenantId,
      actorId,
      now: timestamp,
      expectedVersion,
      outboxEvent,
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'ledger',
      entityId: ledgerPayload.id,
      action: result.created ? 'CREATE' : 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `원장 업데이트: ${ledgerPayload.name}`,
      metadata: {
        source: 'bff',
        version: result.version,
        projectId: ledgerPayload.projectId,
        outboxId: outboxEvent.id,
      },
      timestamp,
    });

    return {
      status: result.created ? 201 : 200,
      body: {
        id: ledgerPayload.id,
        tenantId,
        version: result.version,
        updatedAt: result.data.updatedAt,
      },
    };
  }));

  app.post('/api/v1/transactions', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write transactions');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(transactionUpsertSchema, req.body, 'Invalid transaction payload');
    const expectedVersion = parsed.expectedVersion;

    const projectPath = `orgs/${tenantId}/projects/${parsed.projectId}`;
    const ledgerPath = `orgs/${tenantId}/ledgers/${parsed.ledgerId}`;

    await ensureDocumentExists(db, projectPath, `Project not found: ${parsed.projectId}`);
    const ledger = await ensureDocumentExists(db, ledgerPath, `Ledger not found: ${parsed.ledgerId}`);
    if (ledger.projectId !== parsed.projectId) {
      throw createHttpError(400, `Ledger ${parsed.ledgerId} does not belong to project ${parsed.projectId}`);
    }

    const txPayload = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: parsed.id.trim(),
      projectId: parsed.projectId.trim(),
      ledgerId: parsed.ledgerId.trim(),
      counterparty: parsed.counterparty.trim(),
      state: normalizeState(parsed.state || 'DRAFT'),
    };

    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'transaction.upsert',
      entityType: 'transaction',
      entityId: txPayload.id,
      payload: {
        projectId: txPayload.projectId,
        ledgerId: txPayload.ledgerId,
        counterparty: txPayload.counterparty,
        state: txPayload.state,
        expectedVersion: expectedVersion ?? null,
      },
      createdAt: timestamp,
    });

    const result = await upsertVersionedDoc({
      db,
      path: `orgs/${tenantId}/transactions/${txPayload.id}`,
      payload: txPayload,
      tenantId,
      actorId,
      now: timestamp,
      expectedVersion,
      outboxEvent,
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'transaction',
      entityId: txPayload.id,
      action: result.created ? 'CREATE' : 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `거래 업데이트: ${txPayload.counterparty}`,
      metadata: {
        source: 'bff',
        version: result.version,
        projectId: txPayload.projectId,
        ledgerId: txPayload.ledgerId,
        outboxId: outboxEvent.id,
      },
      timestamp,
    });

    return {
      status: result.created ? 201 : 200,
      body: {
        id: txPayload.id,
        tenantId,
        version: result.version,
        updatedAt: result.data.updatedAt,
        state: result.data.state,
      },
    };
  }));

  app.patch('/api/v1/transactions/:txId/state', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeTransaction, 'change transaction state');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { txId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(transactionStateSchema, req.body, 'Invalid transaction state payload');
    const nextState = normalizeState(parsed.newState);

    assertReasonForRejected(nextState, parsed.reason);

    const requiredPermission = nextState === 'SUBMITTED'
      ? 'transaction:submit'
      : nextState === 'APPROVED'
        ? 'transaction:approve'
        : nextState === 'REJECTED'
          ? 'transaction:reject'
          : null;
    if (requiredPermission) {
      assertActorPermissionAllowed(rbacPolicy, req, requiredPermission, `change transaction state to ${nextState}`);
    }

    const txRef = db.doc(`orgs/${tenantId}/transactions/${txId}`);
    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'transaction.state_changed',
      entityType: 'transaction',
      entityId: txId,
      payload: {
        nextState,
        reason: parsed.reason || null,
        expectedVersion: parsed.expectedVersion,
      },
      createdAt: timestamp,
    });

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(txRef);
      if (!snap.exists) {
        throw createHttpError(404, `Transaction not found: ${txId}`, 'not_found');
      }

      const current = snap.data() || {};
      const currentState = normalizeState(current.state || 'DRAFT');
      const currentVersion = Number.isInteger(current.version) && current.version > 0 ? current.version : 1;

      if (parsed.expectedVersion !== currentVersion) {
        throw createHttpError(
          409,
          `Version mismatch: expected ${parsed.expectedVersion}, actual ${currentVersion}`,
          'version_conflict',
        );
      }

      assertTransitionAllowed({
        currentState,
        nextState,
      });

      const nextVersion = currentVersion + 1;
      const patch = {
        state: nextState,
        tenantId,
        version: nextVersion,
        updatedBy: actorId,
        updatedAt: timestamp,
      };

      if (nextState === 'SUBMITTED') {
        patch.submittedBy = actorId;
        patch.submittedAt = timestamp;
      }
      if (nextState === 'APPROVED') {
        patch.approvedBy = actorId;
        patch.approvedAt = timestamp;
      }
      if (nextState === 'REJECTED') {
        patch.rejectedReason = parsed.reason.trim();
      }

      tx.set(txRef, patch, { merge: true });
      enqueueOutboxEventInTransaction(tx, db, outboxEvent);
      return {
        patch,
        nextVersion,
      };
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'transaction',
      entityId: txId,
      action: `STATE_CHANGE:${result.patch.state}`,
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `거래 상태 변경 → ${result.patch.state}${result.patch.rejectedReason ? ` (사유: ${result.patch.rejectedReason})` : ''}`,
      metadata: {
        source: 'bff',
        version: result.nextVersion,
        outboxId: outboxEvent.id,
      },
      timestamp,
    });

    return {
      status: 200,
      body: {
        id: txId,
        state: result.patch.state,
        rejectedReason: result.patch.rejectedReason ?? null,
        version: result.nextVersion,
        updatedAt: result.patch.updatedAt,
      },
    };
  }));

  app.post('/api/v1/transactions/:txId/comments', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeTransaction, 'write comments');
    assertActorPermissionAllowed(rbacPolicy, req, 'comment:write', 'write comments');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { txId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(commentCreateSchema, req.body, 'Invalid comment payload');

    await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);

    const commentId = parsed.id?.trim() || `c_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const authorName = (parsed.authorName || actorId).trim();
    const authorNameMasked = piiProtector.maskName(authorName) || actorId;
    const authorEncrypted = piiProtector.enabled ? await piiProtector.encryptText(authorName) : null;
    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'comment.created',
      entityType: 'comment',
      entityId: commentId,
      payload: {
        transactionId: txId,
      },
      createdAt: timestamp,
    });

    const comment = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: commentId,
      tenantId,
      transactionId: txId,
      authorId: actorId,
      authorName: piiProtector.enabled ? undefined : authorName,
      authorNameEnc: piiProtector.enabled ? authorEncrypted?.ciphertext : undefined,
      authorNameMasked,
      content: parsed.content.trim(),
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      const batch = db.batch();
      batch.create(db.doc(`orgs/${tenantId}/comments/${commentId}`), comment);
      batch.create(db.doc(`outbox/${outboxEvent.id}`), outboxEvent);
      await batch.commit();
    } catch (error) {
      const alreadyExists = error && (error.code === 6 || /already exists/i.test(error.message || ''));
      if (alreadyExists) {
        throw createHttpError(409, `Comment already exists: ${commentId}`, 'duplicate_id');
      }
      throw error;
    }

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'comment',
      entityId: commentId,
      action: 'CREATE',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `코멘트 추가: tx=${txId}`,
      metadata: { source: 'bff', transactionId: txId, outboxId: outboxEvent.id },
      timestamp,
    });

    return {
      status: 201,
      body: {
        id: commentId,
        transactionId: txId,
        version: 1,
        createdAt: timestamp,
      },
    };
  }));

  app.post('/api/v1/transactions/:txId/evidences', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeTransaction, 'write evidences');
    assertActorPermissionAllowed(rbacPolicy, req, 'evidence:write', 'write evidences');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { txId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(evidenceCreateSchema, req.body, 'Invalid evidence payload');

    await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);

    const evidenceId = parsed.id?.trim() || `ev_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'evidence.created',
      entityType: 'evidence',
      entityId: evidenceId,
      payload: {
        transactionId: txId,
        fileName: parsed.fileName.trim(),
      },
      createdAt: timestamp,
    });

    const evidence = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: evidenceId,
      tenantId,
      transactionId: txId,
      status: parsed.status || 'PENDING',
      uploadedBy: actorId,
      uploadedAt: timestamp,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      const batch = db.batch();
      batch.create(db.doc(`orgs/${tenantId}/evidences/${evidenceId}`), evidence);
      batch.create(db.doc(`outbox/${outboxEvent.id}`), outboxEvent);
      await batch.commit();
    } catch (error) {
      const alreadyExists = error && (error.code === 6 || /already exists/i.test(error.message || ''));
      if (alreadyExists) {
        throw createHttpError(409, `Evidence already exists: ${evidenceId}`, 'duplicate_id');
      }
      throw error;
    }

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'evidence',
      entityId: evidenceId,
      action: 'CREATE',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `증빙 추가: ${evidence.fileName}`,
      metadata: { source: 'bff', transactionId: txId, fileName: evidence.fileName, outboxId: outboxEvent.id },
      timestamp,
    });

    return {
      status: 201,
      body: {
        id: evidenceId,
        transactionId: txId,
        version: 1,
        uploadedAt: timestamp,
      },
    };
  }));

  app.patch('/api/v1/members/:memberId/role', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.memberWrite, 'update member roles');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { memberId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(memberRoleUpdateSchema, req.body, 'Invalid role update payload');
    const targetRole = normalizeRole(parsed.role);

    if (!canActorAssignRole(rbacPolicy, { actorRole, targetRole })) {
      throw createHttpError(403, `Role '${actorRole || 'unknown'}' cannot assign '${targetRole}'`, 'forbidden');
    }

    const memberRef = db.doc(`orgs/${tenantId}/members/${memberId}`);
    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'member.role_changed',
      entityType: 'member',
      entityId: memberId,
      payload: {
        actorRole: actorRole || null,
        targetRole,
        reason: parsed.reason?.trim() || null,
      },
      createdAt: timestamp,
    });

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(memberRef);
      if (!snap.exists) {
        throw createHttpError(404, `Member not found: ${memberId}`, 'not_found');
      }

      const current = snap.data() || {};
      const previousRole = normalizeRole(current.role || 'viewer');

      if (previousRole === 'admin' && targetRole !== 'admin') {
        const adminsSnap = await tx.get(
          db.collection(`orgs/${tenantId}/members`).where('role', '==', 'admin').limit(2),
        );
        if (adminsSnap.size <= 1) {
          throw createHttpError(409, 'Cannot remove the last remaining admin', 'last_admin_lockout');
        }
      }

      tx.set(memberRef, {
        tenantId,
        role: targetRole,
        updatedAt: timestamp,
        updatedBy: actorId,
        roleChangedAt: timestamp,
        roleChangedBy: actorId,
        roleChangeReason: parsed.reason?.trim() || null,
      }, { merge: true });
      enqueueOutboxEventInTransaction(tx, db, outboxEvent);

      return {
        previousRole,
      };
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'member',
      entityId: memberId,
      action: 'ROLE_CHANGE',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `멤버 권한 변경: ${result.previousRole} -> ${targetRole}`,
      metadata: {
        source: 'bff',
        previousRole: result.previousRole,
        nextRole: targetRole,
        reason: parsed.reason?.trim() || null,
        outboxId: outboxEvent.id,
      },
      timestamp,
    });

    return {
      status: 200,
      body: {
        id: memberId,
        previousRole: result.previousRole,
        role: targetRole,
        updatedAt: timestamp,
      },
    };
  }));

  app.use((error, req, res, _next) => {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const message = statusCode >= 500 ? 'Internal server error' : (error?.message || 'Request failed');
    const errorCode = error?.code || (statusCode >= 500 ? 'internal_error' : 'request_error');
    res.locals.errorCode = errorCode;

    if (statusCode >= 500) {
      // eslint-disable-next-line no-console
      console.error('[bff] unhandled error', error);
    }

    res.status(statusCode).json({
      error: errorCode,
      message,
      requestId: req.requestId || req.context?.requestId,
    });
  });

  return app;
}
