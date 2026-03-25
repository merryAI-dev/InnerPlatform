import { randomUUID } from 'node:crypto';
import { createOutboxEvent, enqueueOutboxEventInTransaction } from '../outbox.mjs';
import {
  DriveServiceError,
  inferEvidenceCategoryFromFileName,
  resolveEvidenceSyncPatch,
} from '../google-drive.mjs';
import { assertTransitionAllowed, normalizeState } from '../state-policy.mjs';
import { updateCounterpartyHistory } from '../counterparty-budget-history.mjs';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed, assertActorPermissionAllowed,
  ROUTE_ROLES, createHttpError, encryptAuditEmail,
  parseLimit, parseCursor, buildListResponse,
  ensureDocumentExists, upsertVersionedDoc, mergeSystemManagedDoc,
  stripServerManagedFields, stripExpectedVersion, stripUndefinedDeep,
  readOptionalText, assertReasonForRejected,
  toDriveEvidenceDocId, chunkArray, resolveAutoLedgerName,
} from '../bff-utils.mjs';
import {
  parseWithSchema,
  transactionUpsertSchema,
  transactionStateSchema,
  commentCreateSchema,
  evidenceCreateSchema,
  evidenceDriveOverrideSchema,
  evidenceDriveUploadSchema,
} from '../schemas.mjs';

// ── syncDriveEvidenceState (local, takes db explicitly) ──────────────────────

async function syncDriveEvidenceState({ db, tenantId, actorId, txId, transaction, folder, files, timestamp }) {
  const evidenceSnap = await db
    .collection(`orgs/${tenantId}/evidences`)
    .where('transactionId', '==', txId)
    .get();

  const existingEvidenceByFileId = new Map();
  evidenceSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const driveFileId = readOptionalText(data.driveFileId);
    if (driveFileId) existingEvidenceByFileId.set(driveFileId, { id: doc.id, ...data });
  });

  const evidenceDocs = files.map((file) => {
    const existing = existingEvidenceByFileId.get(file.id);
    const parser = inferEvidenceCategoryFromFileName(file.name);
    const category = readOptionalText(existing?.category)
      || readOptionalText(file.appProperties?.category)
      || parser.category;
    return {
      id: existing?.id || toDriveEvidenceDocId(file.id),
      tenantId,
      transactionId: txId,
      fileName: file.name || 'untitled',
      originalFileName: readOptionalText(existing?.originalFileName)
        || readOptionalText(file.appProperties?.originalFileName)
        || undefined,
      fileType: file.mimeType || 'application/octet-stream',
      fileSize: file.size || 0,
      uploadedBy: existing?.uploadedBy || actorId,
      uploadedAt: existing?.uploadedAt || timestamp,
      category,
      status: existing?.status || 'PENDING',
      source: existing?.source || 'DRIVE_SYNC',
      driveFileId: file.id,
      driveFolderId: folder.id,
      driveFolderName: folder.name,
      webViewLink: file.webViewLink || undefined,
      mimeType: file.mimeType || 'application/octet-stream',
      parserCategory: parser.category,
      parserConfidence: parser.confidence,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      version: Number.isInteger(existing?.version) && existing.version > 0 ? existing.version + 1 : 1,
    };
  });

  for (const docs of chunkArray(evidenceDocs, 400)) {
    const batch = db.batch();
    docs.forEach((evidence) => {
      batch.set(db.doc(`orgs/${tenantId}/evidences/${evidence.id}`), stripUndefinedDeep(evidence), { merge: true });
    });
    await batch.commit();
  }

  const syncPatch = resolveEvidenceSyncPatch({
    transaction: {
      ...transaction,
      evidenceDriveLink: folder.webViewLink || transaction.evidenceDriveLink,
    },
    evidences: evidenceDocs,
    folder,
  });

  return { evidenceDocs, syncPatch };
}

// ── Route mounts ─────────────────────────────────────────────────────────────

export function mountTransactionRoutes(app, {
  db, now, idempotencyService, auditChainService, piiProtector, rbacPolicy,
  driveService,
}) {
  // ── GET /api/v1/transactions ─────────────────────────────────────────────────
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
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  // ── GET /api/v1/transactions/:txId/comments ──────────────────────────────────
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

  // ── GET /api/v1/transactions/:txId/evidences ─────────────────────────────────
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

  // ── POST /api/v1/transactions ────────────────────────────────────────────────
  app.post('/api/v1/transactions', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write transactions');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(transactionUpsertSchema, req.body, 'Invalid transaction payload');
    const expectedVersion = parsed.expectedVersion;

    const projectPath = `orgs/${tenantId}/projects/${parsed.projectId}`;
    const ledgerPath = `orgs/${tenantId}/ledgers/${parsed.ledgerId}`;

    const project = await ensureDocumentExists(db, projectPath, `Project not found: ${parsed.projectId}`);
    const ledgerRef = db.doc(ledgerPath);
    const ledgerSnap = await ledgerRef.get();
    let ledger = ledgerSnap.exists ? (ledgerSnap.data() || {}) : null;

    if (!ledger) {
      try {
        const ensuredLedger = await upsertVersionedDoc({
          db,
          path: ledgerPath,
          payload: {
            id: parsed.ledgerId.trim(),
            projectId: parsed.projectId.trim(),
            name: resolveAutoLedgerName(project),
          },
          tenantId,
          actorId,
          now: timestamp,
          expectedVersion: 0,
        });
        ledger = ensuredLedger.data;
      } catch (error) {
        const statusCode = Number.isFinite(error?.statusCode) ? Number(error.statusCode) : 0;
        const errorCode = readOptionalText(error?.code);
        if (statusCode !== 409 && errorCode !== 'version_conflict' && errorCode !== 'version_required') throw error;
        const retryLedgerSnap = await ledgerRef.get();
        if (!retryLedgerSnap.exists) throw error;
        ledger = retryLedgerSnap.data() || {};
      }
    }

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

    // 비목이 입력된 경우 거래처 히스토리 업데이트 (fire-and-forget, 실패해도 무관)
    if (txPayload.budgetCategory) {
      updateCounterpartyHistory(db, tenantId, txPayload).catch(() => {});
    }

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

  // ── PATCH /api/v1/transactions/:txId/state ───────────────────────────────────
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
      payload: { nextState, reason: parsed.reason || null, expectedVersion: parsed.expectedVersion },
      createdAt: timestamp,
    });

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(txRef);
      if (!snap.exists) throw createHttpError(404, `Transaction not found: ${txId}`, 'not_found');

      const current = snap.data() || {};
      const currentState = normalizeState(current.state || 'DRAFT');
      const currentVersion = Number.isInteger(current.version) && current.version > 0 ? current.version : 1;

      if (parsed.expectedVersion !== currentVersion) {
        throw createHttpError(409, `Version mismatch: expected ${parsed.expectedVersion}, actual ${currentVersion}`, 'version_conflict');
      }

      assertTransitionAllowed({ currentState, nextState });

      const nextVersion = currentVersion + 1;
      const patch = { state: nextState, tenantId, version: nextVersion, updatedBy: actorId, updatedAt: timestamp };

      if (nextState === 'SUBMITTED') { patch.submittedBy = actorId; patch.submittedAt = timestamp; }
      if (nextState === 'APPROVED') { patch.approvedBy = actorId; patch.approvedAt = timestamp; }
      if (nextState === 'REJECTED') { patch.rejectedReason = parsed.reason.trim(); }

      tx.set(txRef, patch, { merge: true });
      enqueueOutboxEventInTransaction(tx, db, outboxEvent);
      return { patch, nextVersion };
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
      metadata: { source: 'bff', version: result.nextVersion, outboxId: outboxEvent.id },
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

  // ── POST /api/v1/transactions/:txId/comments ─────────────────────────────────
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
      payload: { transactionId: txId },
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
      if (alreadyExists) throw createHttpError(409, `Comment already exists: ${commentId}`, 'duplicate_id');
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
      body: { id: commentId, transactionId: txId, version: 1, createdAt: timestamp },
    };
  }));

  // ── POST /api/v1/transactions/:txId/evidences ────────────────────────────────
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
      payload: { transactionId: txId, fileName: parsed.fileName.trim() },
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
      if (alreadyExists) throw createHttpError(409, `Evidence already exists: ${evidenceId}`, 'duplicate_id');
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
      body: { id: evidenceId, transactionId: txId, version: 1, uploadedAt: timestamp },
    };
  }));

  // ── POST /api/v1/transactions/:txId/evidence-drive/provision ─────────────────
  app.post('/api/v1/transactions/:txId/evidence-drive/provision', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeEvidenceDrive, 'provision evidence drive folder');
    assertActorPermissionAllowed(rbacPolicy, req, 'evidence:drive:write', 'provision evidence drive folder');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { txId } = req.params;
    const timestamp = now();

    const transaction = await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);
    const project = await ensureDocumentExists(db, `orgs/${tenantId}/projects/${transaction.projectId}`, `Project not found: ${transaction.projectId}`);

    let linkedFolder;
    try {
      linkedFolder = await driveService.ensureTransactionFolder({
        tenantId,
        projectId: transaction.projectId,
        projectName: project.name || transaction.projectId,
        projectFolderId: project.evidenceDriveRootFolderId,
        existingFolderId: transaction.evidenceDriveFolderId,
        transaction,
      });
    } catch (error) {
      if (error instanceof DriveServiceError) throw createHttpError(error.statusCode, error.message, error.code);
      throw error;
    }

    const folder = linkedFolder.folder;
    const projectRootFolder = linkedFolder.projectRootFolder;

    const projectUpdate = !project.evidenceDriveRootFolderId || project.evidenceDriveRootFolderId !== projectRootFolder.id
      ? mergeSystemManagedDoc({
        db,
        path: `orgs/${tenantId}/projects/${transaction.projectId}`,
        patch: {
          evidenceDriveSharedDriveId: projectRootFolder.driveId || project.evidenceDriveSharedDriveId || undefined,
          evidenceDriveRootFolderId: projectRootFolder.id,
          evidenceDriveRootFolderName: projectRootFolder.name,
          evidenceDriveRootFolderLink: projectRootFolder.webViewLink || undefined,
          evidenceDriveProvisionedAt: timestamp,
        },
        tenantId,
        actorId,
        now: timestamp,
        notFoundMessage: `Project not found: ${transaction.projectId}`,
      })
      : Promise.resolve(null);

    const txResult = await mergeSystemManagedDoc({
      db,
      path: `orgs/${tenantId}/transactions/${txId}`,
      patch: {
        evidenceDriveSharedDriveId: folder.driveId || transaction.evidenceDriveSharedDriveId || undefined,
        evidenceDriveFolderId: folder.id,
        evidenceDriveFolderName: folder.name,
        evidenceDriveLink: folder.webViewLink || undefined,
        evidenceDriveSyncStatus: 'LINKED',
      },
      tenantId,
      actorId,
      now: timestamp,
      notFoundMessage: `Transaction not found: ${txId}`,
    });

    await projectUpdate;

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'transaction',
      entityId: txId,
      action: 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `거래 증빙 폴더 연결: ${folder.name}`,
      metadata: { source: 'bff', transactionId: txId, folderId: folder.id, folderName: folder.name, projectFolderId: projectRootFolder.id },
      timestamp,
    });

    return {
      status: 200,
      body: {
        transactionId: txId,
        projectId: transaction.projectId,
        projectFolderId: projectRootFolder.id,
        projectFolderName: projectRootFolder.name,
        folderId: folder.id,
        folderName: folder.name,
        webViewLink: folder.webViewLink || null,
        sharedDriveId: folder.driveId || null,
        syncStatus: 'LINKED',
        version: txResult.version,
        updatedAt: txResult.data.updatedAt,
      },
    };
  }));

  // ── POST /api/v1/transactions/:txId/evidence-drive/sync ──────────────────────
  app.post('/api/v1/transactions/:txId/evidence-drive/sync', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeEvidenceDrive, 'sync evidence drive folder');
    assertActorPermissionAllowed(rbacPolicy, req, 'evidence:drive:write', 'sync evidence drive folder');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { txId } = req.params;
    const timestamp = now();

    const transaction = await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);
    const project = await ensureDocumentExists(db, `orgs/${tenantId}/projects/${transaction.projectId}`, `Project not found: ${transaction.projectId}`);

    let linkedFolder;
    let files;
    try {
      linkedFolder = await driveService.ensureTransactionFolder({
        tenantId,
        projectId: transaction.projectId,
        projectName: project.name || transaction.projectId,
        projectFolderId: project.evidenceDriveRootFolderId,
        existingFolderId: transaction.evidenceDriveFolderId,
        transaction,
      });
      files = await driveService.listFolderFiles({ folderId: linkedFolder.folder.id });
    } catch (error) {
      if (error instanceof DriveServiceError) throw createHttpError(error.statusCode, error.message, error.code);
      throw error;
    }

    const folder = linkedFolder.folder;
    const { evidenceDocs, syncPatch } = await syncDriveEvidenceState({
      db, tenantId, actorId, txId, transaction, folder, files, timestamp,
    });

    const projectUpdate = !project.evidenceDriveRootFolderId || project.evidenceDriveRootFolderId !== linkedFolder.projectRootFolder.id
      ? mergeSystemManagedDoc({
        db,
        path: `orgs/${tenantId}/projects/${transaction.projectId}`,
        patch: {
          evidenceDriveSharedDriveId: linkedFolder.projectRootFolder.driveId || project.evidenceDriveSharedDriveId || undefined,
          evidenceDriveRootFolderId: linkedFolder.projectRootFolder.id,
          evidenceDriveRootFolderName: linkedFolder.projectRootFolder.name,
          evidenceDriveRootFolderLink: linkedFolder.projectRootFolder.webViewLink || undefined,
          evidenceDriveProvisionedAt: timestamp,
        },
        tenantId,
        actorId,
        now: timestamp,
        notFoundMessage: `Project not found: ${transaction.projectId}`,
      })
      : Promise.resolve(null);

    const txResult = await mergeSystemManagedDoc({
      db,
      path: `orgs/${tenantId}/transactions/${txId}`,
      patch: {
        ...syncPatch,
        evidenceDriveSharedDriveId: folder.driveId || transaction.evidenceDriveSharedDriveId || undefined,
        evidenceDriveFolderId: folder.id,
        evidenceDriveFolderName: folder.name,
        evidenceDriveLink: folder.webViewLink || transaction.evidenceDriveLink || undefined,
        evidenceDriveSyncStatus: 'SYNCED',
        evidenceDriveLastSyncedAt: timestamp,
      },
      tenantId,
      actorId,
      now: timestamp,
      notFoundMessage: `Transaction not found: ${txId}`,
    });

    await projectUpdate;

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'transaction',
      entityId: txId,
      action: 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `거래 증빙 Drive 동기화: ${evidenceDocs.length}건`,
      metadata: { source: 'bff', transactionId: txId, folderId: folder.id, evidenceCount: evidenceDocs.length },
      timestamp,
    });

    return {
      status: 200,
      body: {
        transactionId: txId,
        projectId: transaction.projectId,
        folderId: folder.id,
        folderName: folder.name,
        webViewLink: folder.webViewLink || null,
        sharedDriveId: folder.driveId || null,
        evidenceCount: evidenceDocs.length,
        evidenceCompletedDesc: txResult.data.evidenceCompletedDesc || null,
        evidenceCompletedManualDesc: txResult.data.evidenceCompletedManualDesc || null,
        evidenceAutoListedDesc: txResult.data.evidenceAutoListedDesc || null,
        evidencePendingDesc: txResult.data.evidencePendingDesc || null,
        supportPendingDocs: txResult.data.supportPendingDocs || null,
        evidenceMissing: txResult.data.evidenceMissing || [],
        evidenceStatus: txResult.data.evidenceStatus,
        lastSyncedAt: timestamp,
        version: txResult.version,
        updatedAt: txResult.data.updatedAt,
      },
    };
  }));

  // ── POST /api/v1/transactions/:txId/evidence-drive/overrides ─────────────────
  app.post('/api/v1/transactions/:txId/evidence-drive/overrides', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeEvidenceDrive, 'override evidence drive metadata');
    assertActorPermissionAllowed(rbacPolicy, req, 'evidence:drive:write', 'override evidence drive metadata');
    const { tenantId, actorId } = req.context;
    const { txId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(evidenceDriveOverrideSchema, req.body, 'Invalid evidence drive override payload');

    const transaction = await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);

    const snapshot = await db.collection(`orgs/${tenantId}/evidences`).where('transactionId', '==', txId).get();

    const overrideByFileId = new Map(
      parsed.items.map((item) => [item.driveFileId.trim(), item.category.trim()]),
    );
    const evidenceDocs = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

    const docsToUpdate = evidenceDocs.filter((item) => overrideByFileId.has(readOptionalText(item.driveFileId)));
    if (docsToUpdate.length > 0) {
      for (const docs of chunkArray(docsToUpdate, 400)) {
        const batch = db.batch();
        docs.forEach((item) => {
          const category = overrideByFileId.get(readOptionalText(item.driveFileId));
          if (!category) return;
          batch.set(db.doc(`orgs/${tenantId}/evidences/${item.id}`), { category, updatedAt: timestamp }, { merge: true });
          item.category = category;
          item.updatedAt = timestamp;
        });
        await batch.commit();
      }
    }

    const syncPatch = resolveEvidenceSyncPatch({
      transaction,
      evidences: evidenceDocs,
      folder: {
        id: transaction.evidenceDriveFolderId,
        name: transaction.evidenceDriveFolderName,
        webViewLink: transaction.evidenceDriveLink,
        driveId: transaction.evidenceDriveSharedDriveId,
      },
    });

    const txResult = await mergeSystemManagedDoc({
      db,
      path: `orgs/${tenantId}/transactions/${txId}`,
      patch: syncPatch,
      tenantId,
      actorId,
      now: timestamp,
      notFoundMessage: `Transaction not found: ${txId}`,
    });

    return {
      status: 200,
      body: {
        transactionId: txId,
        projectId: transaction.projectId,
        folderId: transaction.evidenceDriveFolderId || null,
        folderName: transaction.evidenceDriveFolderName || null,
        webViewLink: transaction.evidenceDriveLink || null,
        sharedDriveId: transaction.evidenceDriveSharedDriveId || null,
        evidenceCount: evidenceDocs.length,
        evidenceCompletedDesc: txResult.data.evidenceCompletedDesc || null,
        evidenceCompletedManualDesc: txResult.data.evidenceCompletedManualDesc || null,
        evidenceAutoListedDesc: txResult.data.evidenceAutoListedDesc || null,
        evidencePendingDesc: txResult.data.evidencePendingDesc || null,
        supportPendingDocs: txResult.data.supportPendingDocs || null,
        evidenceMissing: txResult.data.evidenceMissing || [],
        evidenceStatus: txResult.data.evidenceStatus,
        lastSyncedAt: transaction.evidenceDriveLastSyncedAt || timestamp,
        version: txResult.version,
        updatedAt: txResult.data.updatedAt,
      },
    };
  }));

  // ── POST /api/v1/transactions/:txId/evidence-drive/upload ────────────────────
  app.post('/api/v1/transactions/:txId/evidence-drive/upload', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeEvidenceDrive, 'upload evidence drive file');
    assertActorPermissionAllowed(rbacPolicy, req, 'evidence:drive:write', 'upload evidence drive file');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { txId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(evidenceDriveUploadSchema, req.body, 'Invalid evidence drive upload payload');

    const transaction = await ensureDocumentExists(db, `orgs/${tenantId}/transactions/${txId}`, `Transaction not found: ${txId}`);
    const project = await ensureDocumentExists(db, `orgs/${tenantId}/projects/${transaction.projectId}`, `Project not found: ${transaction.projectId}`);

    let linkedFolder;
    let uploadedFile;
    let files;
    try {
      linkedFolder = await driveService.ensureTransactionFolder({
        tenantId,
        projectId: transaction.projectId,
        projectName: project.name || transaction.projectId,
        projectFolderId: project.evidenceDriveRootFolderId,
        existingFolderId: transaction.evidenceDriveFolderId,
        transaction,
      });
      uploadedFile = await driveService.uploadFileToFolder({
        folderId: linkedFolder.folder.id,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        contentBase64: parsed.contentBase64,
        appProperties: {
          managedBy: 'mysc-platform',
          tenantId,
          projectId: transaction.projectId,
          transactionId: txId,
          evidenceSource: 'platform-upload',
          originalFileName: parsed.originalFileName || parsed.fileName,
        },
      });
      files = await driveService.listFolderFiles({ folderId: linkedFolder.folder.id });
    } catch (error) {
      if (error instanceof DriveServiceError) throw createHttpError(error.statusCode, error.message, error.code);
      throw error;
    }

    const folder = linkedFolder.folder;
    const parser = inferEvidenceCategoryFromFileName(parsed.fileName);
    const { evidenceDocs } = await syncDriveEvidenceState({
      db, tenantId, actorId, txId, transaction, folder, files, timestamp,
    });

    const uploadedEvidence = evidenceDocs.find((item) => item.driveFileId === uploadedFile.id);
    if (uploadedEvidence && parsed.category && parsed.category.trim()) {
      const overriddenCategory = parsed.category.trim();
      await db.doc(`orgs/${tenantId}/evidences/${uploadedEvidence.id}`).set({ category: overriddenCategory, updatedAt: timestamp }, { merge: true });
      uploadedEvidence.category = overriddenCategory;
    }

    const syncPatch = resolveEvidenceSyncPatch({
      transaction: { ...transaction, evidenceDriveLink: folder.webViewLink || transaction.evidenceDriveLink },
      evidences: evidenceDocs,
      folder,
    });

    const projectUpdate = !project.evidenceDriveRootFolderId || project.evidenceDriveRootFolderId !== linkedFolder.projectRootFolder.id
      ? mergeSystemManagedDoc({
        db,
        path: `orgs/${tenantId}/projects/${transaction.projectId}`,
        patch: {
          evidenceDriveSharedDriveId: linkedFolder.projectRootFolder.driveId || project.evidenceDriveSharedDriveId || undefined,
          evidenceDriveRootFolderId: linkedFolder.projectRootFolder.id,
          evidenceDriveRootFolderName: linkedFolder.projectRootFolder.name,
          evidenceDriveRootFolderLink: linkedFolder.projectRootFolder.webViewLink || undefined,
          evidenceDriveProvisionedAt: timestamp,
        },
        tenantId,
        actorId,
        now: timestamp,
        notFoundMessage: `Project not found: ${transaction.projectId}`,
      })
      : Promise.resolve(null);

    const txResult = await mergeSystemManagedDoc({
      db,
      path: `orgs/${tenantId}/transactions/${txId}`,
      patch: {
        ...syncPatch,
        evidenceDriveSharedDriveId: folder.driveId || transaction.evidenceDriveSharedDriveId || undefined,
        evidenceDriveFolderId: folder.id,
        evidenceDriveFolderName: folder.name,
        evidenceDriveLink: folder.webViewLink || transaction.evidenceDriveLink || undefined,
        evidenceDriveSyncStatus: 'SYNCED',
        evidenceDriveLastSyncedAt: timestamp,
      },
      tenantId,
      actorId,
      now: timestamp,
      notFoundMessage: `Transaction not found: ${txId}`,
    });

    await projectUpdate;

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'evidence',
      entityId: uploadedEvidence?.id || toDriveEvidenceDocId(uploadedFile.id),
      action: 'CREATE',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `증빙 Drive 업로드: ${parsed.fileName}`,
      metadata: { source: 'bff', transactionId: txId, folderId: folder.id, driveFileId: uploadedFile.id, parserCategory: parser.category },
      timestamp,
    });

    return {
      status: 201,
      body: {
        transactionId: txId,
        projectId: transaction.projectId,
        folderId: folder.id,
        folderName: folder.name,
        driveFileId: uploadedFile.id,
        fileName: uploadedFile.name || parsed.fileName,
        originalFileName: parsed.originalFileName || null,
        webViewLink: uploadedFile.webViewLink || null,
        category: (parsed.category && parsed.category.trim()) || uploadedEvidence?.category || parser.category,
        parserCategory: parser.category,
        parserConfidence: parser.confidence,
        sharedDriveId: folder.driveId || null,
        evidenceCount: evidenceDocs.length,
        evidenceCompletedDesc: txResult.data.evidenceCompletedDesc || null,
        evidenceCompletedManualDesc: txResult.data.evidenceCompletedManualDesc || null,
        evidenceAutoListedDesc: txResult.data.evidenceAutoListedDesc || null,
        evidencePendingDesc: txResult.data.evidencePendingDesc || null,
        supportPendingDocs: txResult.data.supportPendingDocs || null,
        evidenceMissing: txResult.data.evidenceMissing || [],
        evidenceStatus: txResult.data.evidenceStatus,
        lastSyncedAt: timestamp,
        version: txResult.version,
        updatedAt: txResult.data.updatedAt,
      },
    };
  }));
}
