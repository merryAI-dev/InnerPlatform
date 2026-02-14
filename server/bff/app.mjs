import express from 'express';
import { randomUUID } from 'node:crypto';
import { createFirestoreDb, isFirestoreEmulatorEnabled, resolveProjectId } from './firestore.mjs';
import { createIdempotencyService } from './idempotency.mjs';
import { createAuditChainService } from './audit-chain.mjs';
import {
  createOutboxEvent,
  enqueueOutboxEventInTransaction,
} from './outbox.mjs';
import { createPiiProtector } from './pii-protection.mjs';
import { canActorAssignRole, loadRbacPolicy } from './rbac-policy.mjs';
import {
  assertTenantId,
  createRequestId,
  normalizeActorId,
} from './utils.mjs';
import {
  commentCreateSchema,
  evidenceCreateSchema,
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

function stripExpectedVersion(payload) {
  const cloned = { ...payload };
  delete cloned.expectedVersion;
  return cloned;
}

function assertReasonForRejected(state, reason) {
  if (state === 'REJECTED' && (!reason || !reason.trim())) {
    throw createHttpError(400, 'REJECTED transition requires a rejection reason');
  }
}

function normalizeRole(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

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

function assertApiHeaders(req, res, next) {
  try {
    const tenantId = assertTenantId(req.header('x-tenant-id'));
    const actorId = normalizeActorId(req.header('x-actor-id'));
    const actorRole = normalizeRole(req.header('x-actor-role')) || undefined;
    const actorEmail = (req.header('x-actor-email') || '').trim().toLowerCase() || undefined;
    const requestId = req.header('x-request-id') || createRequestId();

    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    const idempotencyKey = req.header('idempotency-key') || '';

    if (isMutating && !idempotencyKey.trim()) {
      throw createHttpError(400, 'idempotency-key header is required for mutating requests');
    }

    req.context = {
      tenantId,
      actorId,
      actorRole,
      actorEmail,
      requestId,
      idempotencyKey: idempotencyKey.trim() || undefined,
    };

    res.setHeader('x-request-id', requestId);
    next();
  } catch (error) {
    next(error);
  }
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
  const idempotencyService = createIdempotencyService(db);
  const auditChainService = createAuditChainService(db, { now });
  const piiProtector = options.piiProtector || createPiiProtector();
  const rbacPolicy = options.rbacPolicy || loadRbacPolicy();
  const allowedOrigins = String(process.env.BFF_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const requestOrigin = req.header('origin') || '';
    const allowAny = allowedOrigins.includes('*');
    const isAllowed = allowAny || allowedOrigins.includes(requestOrigin);
    const chosenOrigin = allowAny ? '*' : (isAllowed ? requestOrigin : '');

    if (chosenOrigin) {
      res.setHeader('Access-Control-Allow-Origin', chosenOrigin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tenant-id, x-actor-id, x-actor-role, x-actor-email, x-request-id, idempotency-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');

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

  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'mysc-bff',
      projectId,
      firestoreEmulator: isFirestoreEmulatorEnabled(),
      timestamp: now(),
    });
  });

  app.use('/api/v1', assertApiHeaders);

  app.get('/api/v1/projects', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    const limit = parseLimit(req.query.limit, 50, 200);
    const snap = await db.collection(`orgs/${tenantId}/projects`).limit(limit).get();
    const items = snap.docs.map((doc) => doc.data());
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/ledgers', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    const limit = parseLimit(req.query.limit, 50, 200);
    const projectIdFilter = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';

    let query = db.collection(`orgs/${tenantId}/ledgers`).limit(limit);
    if (projectIdFilter) {
      query = query.where('projectId', '==', projectIdFilter);
    }

    const snap = await query.get();
    const items = snap.docs.map((doc) => doc.data());
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/transactions', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    const limit = parseLimit(req.query.limit, 50, 200);
    const projectIdFilter = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    const ledgerIdFilter = typeof req.query.ledgerId === 'string' ? req.query.ledgerId.trim() : '';

    let query = db.collection(`orgs/${tenantId}/transactions`).limit(limit);
    if (projectIdFilter) query = query.where('projectId', '==', projectIdFilter);
    if (ledgerIdFilter) query = query.where('ledgerId', '==', ledgerIdFilter);

    const snap = await query.get();
    const items = snap.docs.map((doc) => doc.data());
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/transactions/:txId/comments', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    const { txId } = req.params;
    const limit = parseLimit(req.query.limit, 100, 500);

    await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);

    const snap = await db
      .collection(`orgs/${tenantId}/comments`)
      .where('transactionId', '==', txId)
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
        ...raw,
        authorName: authorName || raw.authorNameMasked || raw.authorId,
      });
    }
    items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/transactions/:txId/evidences', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    const { txId } = req.params;
    const limit = parseLimit(req.query.limit, 100, 500);

    await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);

    const snap = await db
      .collection(`orgs/${tenantId}/evidences`)
      .where('transactionId', '==', txId)
      .limit(limit)
      .get();

    const items = snap.docs.map((doc) => doc.data()).sort((a, b) => (a.uploadedAt || '').localeCompare(b.uploadedAt || ''));
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/audit-logs', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    const limit = parseLimit(req.query.limit, 50, 200);
    const snap = await db.collection(`orgs/${tenantId}/audit_logs`).limit(limit).get();
    const items = snap.docs.map((doc) => doc.data()).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    res.status(200).json({ items, count: items.length });
  }));

  app.get('/api/v1/audit-logs/verify', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    const limit = parseLimit(req.query.limit, 2000, 10000);
    const result = await auditChainService.verify({ tenantId, limit });
    res.status(result.ok ? 200 : 409).json(result);
  }));

  app.post('/api/v1/projects', createMutatingRoute(idempotencyService, async (req) => {
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(projectUpsertSchema, req.body, 'Invalid project payload');
    const expectedVersion = parsed.expectedVersion;

    const projectPayload = {
      ...stripExpectedVersion(parsed),
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
      ...stripExpectedVersion(parsed),
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
      ...stripExpectedVersion(parsed),
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
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { txId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(transactionStateSchema, req.body, 'Invalid transaction state payload');
    const nextState = normalizeState(parsed.newState);

    assertReasonForRejected(nextState, parsed.reason);

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
      ...stripExpectedVersion(parsed),
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
      ...stripExpectedVersion(parsed),
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

    res.status(statusCode).json({
      error: errorCode,
      message,
      requestId: req.requestId || req.context?.requestId,
    });
  });

  return app;
}
