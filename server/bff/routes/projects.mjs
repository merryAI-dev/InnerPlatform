import express from 'express';
import { createOutboxEvent } from '../outbox.mjs';
import {
  DriveServiceError,
  extractDriveFolderId,
} from '../google-drive.mjs';
import { GoogleSheetsServiceError } from '../google-sheets.mjs';
import { extractTextFromPdfBuffer } from '../pdf-text.mjs';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed,
  ROUTE_ROLES, PROJECT_REQUEST_ROUTE_ROLES, createHttpError, encryptAuditEmail,
  parseLimit, parseCursor, buildListResponse,
  ensureDocumentExists, upsertVersionedDoc, mergeSystemManagedDoc,
  stripServerManagedFields, stripExpectedVersion, readOptionalText, decodeHeaderValue,
} from '../bff-utils.mjs';
import {
  parseWithSchema,
  projectUpsertSchema,
  googleSheetImportPreviewSchema,
  googleSheetImportAnalyzeSchema,
  projectSheetSourceUploadSchema,
  projectRequestContractAnalyzeSchema,
  projectRequestContractUploadSchema,
  projectDriveRootLinkSchema,
} from '../schemas.mjs';

function trimSlackText(value, maxLength = 200) {
  const text = readOptionalText(value);
  if (!text) return '-';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatKrw(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatProjectPeriod(start, end) {
  const normalizedStart = readOptionalText(start);
  const normalizedEnd = readOptionalText(end);
  if (normalizedStart && normalizedEnd) return `${normalizedStart} ~ ${normalizedEnd}`;
  return normalizedStart || normalizedEnd || '-';
}

function formatOptionalProjectAmount(value, explicit) {
  if (explicit === false) return '-';
  return Number.isFinite(value) ? formatKrw(value) : '-';
}

function buildProjectRegistrationSlackPayload(projectRequest) {
  const payload = projectRequest?.payload && typeof projectRequest.payload === 'object'
    ? projectRequest.payload
    : {};
  const projectName = trimSlackText(payload.name, 120);
  const officialContractName = trimSlackText(payload.officialContractName, 220);
  const clientOrg = trimSlackText(payload.clientOrg, 160);
  const department = trimSlackText(payload.department, 120);
  const managerName = trimSlackText(payload.managerName, 120);
  const teamName = trimSlackText(payload.teamName, 120);
  const financialInputFlags = payload.financialInputFlags && typeof payload.financialInputFlags === 'object'
    ? payload.financialInputFlags
    : {};
  const requester = trimSlackText(projectRequest?.requestedByName, 120);
  const requesterEmail = trimSlackText(projectRequest?.requestedByEmail, 160);
  const projectId = trimSlackText(projectRequest?.approvedProjectId, 120);
  const purpose = trimSlackText(payload.projectPurpose, 280);
  const lines = [
    '*[InnerPlatform] 신규 프로젝트 등록 완료*',
    `프로젝트명: \`${projectName}\``,
    `계약명: ${officialContractName}`,
    `발주기관: ${clientOrg}`,
    `담당조직: ${department}`,
    `메인 담당자: ${managerName}`,
    `팀장/팀명: ${teamName}`,
    `계약기간: ${formatProjectPeriod(payload.contractStart, payload.contractEnd)}`,
    `계약금액: ${formatOptionalProjectAmount(payload.contractAmount, financialInputFlags.contractAmount)}`,
    `사업목적: ${purpose}`,
    `요청자: ${requester} (${requesterEmail})`,
    `projectId: \`${projectId}\``,
  ];

  return {
    text: `[InnerPlatform] 신규 프로젝트 등록 완료: ${projectName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      },
    ],
  };
}

function buildProjectCreatedSlackPayload(project, context = {}) {
  const payload = project && typeof project === 'object' ? project : {};
  const projectName = trimSlackText(payload.name, 120);
  const officialContractName = trimSlackText(payload.officialContractName, 220);
  const clientOrg = trimSlackText(payload.clientOrg, 160);
  const department = trimSlackText(payload.department, 120);
  const managerName = trimSlackText(payload.managerName, 120);
  const teamName = trimSlackText(payload.teamName, 120);
  const actorId = trimSlackText(context.actorId, 120);
  const actorEmail = trimSlackText(context.actorEmail, 160);
  const tenantId = trimSlackText(context.tenantId, 120);
  const projectId = trimSlackText(payload.id, 120);
  const purpose = trimSlackText(payload.projectPurpose || payload.description, 280);
  const financialInputFlags = payload.financialInputFlags && typeof payload.financialInputFlags === 'object'
    ? payload.financialInputFlags
    : {};
  const lines = [
    '*[InnerPlatform] 신규 프로젝트 등록 완료*',
    `프로젝트명: \`${projectName}\``,
    `계약명: ${officialContractName}`,
    `발주기관: ${clientOrg}`,
    `담당조직: ${department}`,
    `프로젝트유형: ${trimSlackText(payload.type, 80)}`,
    `메인 담당자: ${managerName}`,
    `팀장/팀명: ${teamName}`,
    `계약기간: ${formatProjectPeriod(payload.contractStart, payload.contractEnd)}`,
    `계약금액: ${formatOptionalProjectAmount(payload.contractAmount, financialInputFlags.contractAmount)}`,
    `사업목적: ${purpose}`,
    `등록자: ${actorId} (${actorEmail})`,
    `tenantId: \`${tenantId}\``,
    `projectId: \`${projectId}\``,
  ];

  return {
    text: `[InnerPlatform] 신규 프로젝트 등록 완료: ${projectName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      },
    ],
  };
}

export function mountProjectRoutes(app, {
  db, now, idempotencyService, auditChainService, piiProtector,
  driveService,
  googleSheetsService,
  googleSheetMigrationAiService,
  projectRequestContractAiService,
  projectRequestContractStorageService,
  projectSheetSourceStorageService,
  projectRegistrationSlackService,
}) {
  // ── GET /api/v1/projects ─────────────────────────────────────────────────────
  app.get('/api/v1/projects', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read projects');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);

    let query = db.collection(`orgs/${tenantId}/projects`).orderBy('__name__').limit(limit);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  // ── POST /api/v1/projects ────────────────────────────────────────────────────
  app.post('/api/v1/projects', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write projects');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(projectUpsertSchema, req.body, 'Invalid project payload');
    const expectedVersion = parsed.expectedVersion;
    const driveConfig = typeof driveService?.getConfig === 'function' ? driveService.getConfig() : null;

    const projectPayload = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: parsed.id.trim(),
      name: parsed.name.trim(),
      orgId: tenantId,
    };

    const shouldProvisionProjectDriveRoot = !!(
      driveService
      && typeof driveService.ensureProjectRootFolder === 'function'
      && (driveConfig ? driveConfig.enabled && driveConfig.defaultParentFolderId : true)
      && !projectPayload.evidenceDriveRootFolderId
    );

    if (shouldProvisionProjectDriveRoot) {
      let folder;
      try {
        folder = await driveService.ensureProjectRootFolder({
          tenantId,
          projectId: projectPayload.id,
          projectName: projectPayload.name || projectPayload.id,
          existingFolderId: projectPayload.evidenceDriveRootFolderId,
        });
      } catch (error) {
        if (error instanceof DriveServiceError) throw createHttpError(error.statusCode, error.message, error.code);
        throw error;
      }
      projectPayload.evidenceDriveSharedDriveId = folder.driveId || projectPayload.evidenceDriveSharedDriveId || undefined;
      projectPayload.evidenceDriveRootFolderId = folder.id;
      projectPayload.evidenceDriveRootFolderName = folder.name;
      projectPayload.evidenceDriveRootFolderLink = folder.webViewLink || projectPayload.evidenceDriveRootFolderLink || undefined;
      projectPayload.evidenceDriveProvisionedAt = timestamp;
    }

    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'project.upsert',
      entityType: 'project',
      entityId: projectPayload.id,
      payload: { name: projectPayload.name, expectedVersion: expectedVersion ?? null },
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

    const registrationSource = readOptionalText(result.data.registrationSource);
    if (
      result.created
      && registrationSource === 'pm_portal'
      && projectRegistrationSlackService?.enabled
      && typeof projectRegistrationSlackService.notifyMessage === 'function'
    ) {
      try {
        await projectRegistrationSlackService.notifyMessage(buildProjectCreatedSlackPayload(result.data, {
          tenantId,
          actorId,
          actorEmail,
        }));
      } catch (error) {
        console.error('[BFF] project registration Slack notification failed:', error);
      }
    }

    return {
      status: result.created ? 201 : 200,
      body: {
        id: projectPayload.id,
        tenantId,
        evidenceDriveRootFolderId: result.data.evidenceDriveRootFolderId || null,
        evidenceDriveRootFolderName: result.data.evidenceDriveRootFolderName || null,
        evidenceDriveRootFolderLink: result.data.evidenceDriveRootFolderLink || null,
        evidenceDriveSharedDriveId: result.data.evidenceDriveSharedDriveId || null,
        version: result.version,
        updatedAt: result.data.updatedAt,
      },
    };
  }));

  // ── Google Sheet import ──────────────────────────────────────────────────────
  app.post('/api/v1/projects/:projectId/google-sheet-import/preview', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'preview google sheet import');
    const { projectId } = req.params;
    const parsed = parseWithSchema(googleSheetImportPreviewSchema, req.body, 'Invalid google sheet preview payload');
    const googleAccessToken = readOptionalText(req.header('x-google-access-token'));

    await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    try {
      const preview = await googleSheetsService.previewSpreadsheet({
        value: parsed.value,
        sheetName: parsed.sheetName,
        accessToken: googleAccessToken || undefined,
      });
      res.status(200).json(preview);
    } catch (error) {
      if (error instanceof GoogleSheetsServiceError) throw createHttpError(error.statusCode, error.message, error.code);
      throw error;
    }
  }));

  app.post('/api/v1/projects/:projectId/google-sheet-import/analyze', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'analyze google sheet import');
    const { projectId } = req.params;
    const parsed = parseWithSchema(googleSheetImportAnalyzeSchema, req.body, 'Invalid google sheet analysis payload');

    await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    const analysis = await googleSheetMigrationAiService.analyzePreview({
      spreadsheetTitle: parsed.spreadsheetTitle,
      selectedSheetName: parsed.selectedSheetName,
      matrix: parsed.matrix,
    });
    res.status(200).json(analysis);
  }));

  // ── Sheet source upload ──────────────────────────────────────────────────────
  app.post('/api/v1/projects/:projectId/sheet-sources/upload', asyncHandler(async (req, res) => {
    const { tenantId, actorId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'upload project sheet source');
    const { projectId } = req.params;
    const parsed = parseWithSchema(projectSheetSourceUploadSchema, req.body, 'Invalid project sheet source upload payload');

    await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    const uploaded = await projectSheetSourceStorageService.uploadSource({
      tenantId, actorId, projectId,
      sourceType: parsed.sourceType,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      fileSize: parsed.fileSize,
      contentBase64: parsed.contentBase64,
    });

    const timestamp = uploaded.uploadedAt || now();
    const previewMatrix = parsed.previewMatrix || [];
    const metadata = {
      tenantId, projectId,
      sourceType: parsed.sourceType,
      sheetName: parsed.sheetName,
      fileName: uploaded.name,
      storagePath: uploaded.path,
      downloadURL: uploaded.downloadURL,
      contentType: uploaded.contentType,
      uploadedAt: timestamp,
      rowCount: parsed.rowCount,
      columnCount: parsed.columnCount,
      matchedColumns: parsed.matchedColumns || [],
      unmatchedColumns: parsed.unmatchedColumns || [],
      previewMatrix,
      ...(parsed.applyTarget ? { applyTarget: parsed.applyTarget } : {}),
      updatedAt: timestamp,
      updatedBy: actorId,
    };
    const firestoreMetadata = {
      ...metadata,
      previewMatrixRows: previewMatrix.map((cells) => ({ cells })),
    };
    delete firestoreMetadata.previewMatrix;

    await db.doc(`orgs/${tenantId}/projects/${projectId}/sheet_sources/${parsed.sourceType}`).set(firestoreMetadata, { merge: true });
    res.status(200).json(metadata);
  }));

  // ── Project request contract ─────────────────────────────────────────────────
  app.post('/api/v1/project-requests/contract/analyze', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'analyze project request contract');
    const parsed = parseWithSchema(projectRequestContractAnalyzeSchema, req.body, 'Invalid project request contract analysis payload');
    const analysis = await projectRequestContractAiService.analyzeContract({
      fileName: parsed.fileName,
      documentText: parsed.documentText || '',
    });
    res.status(200).json(analysis);
  }));

  app.post('/api/v1/project-requests/contract/upload', asyncHandler(async (req, res) => {
    const { tenantId, actorId } = req.context;
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'upload project request contract');
    const parsed = parseWithSchema(projectRequestContractUploadSchema, req.body, 'Invalid project request contract upload payload');
    const uploaded = await projectRequestContractStorageService.uploadContract({
      tenantId, actorId,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      fileSize: parsed.fileSize,
      contentBase64: parsed.contentBase64,
    });
    res.status(200).json(uploaded);
  }));

  app.post(
    '/api/v1/project-requests/contract/process',
    express.raw({ type: ['application/octet-stream', 'application/pdf'], limit: process.env.BFF_JSON_LIMIT || '25mb' }),
    asyncHandler(async (req, res) => {
      const { tenantId, actorId } = req.context;
      assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'process project request contract');
      const fileName = decodeHeaderValue(req.header('x-file-name')) || 'contract.pdf';
      const mimeType = readOptionalText(req.header('x-file-type')) || req.header('content-type') || 'application/pdf';
      const fileSizeHeader = Number.parseInt(readOptionalText(req.header('x-file-size')), 10);
      const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);

      if (!fileBuffer.byteLength) {
        throw createHttpError(400, 'Contract upload body is empty', 'empty_contract_upload');
      }

      const contractDocument = await projectRequestContractStorageService.uploadContract({
        tenantId, actorId, fileName, mimeType,
        fileSize: Number.isFinite(fileSizeHeader) ? fileSizeHeader : fileBuffer.byteLength,
        buffer: fileBuffer,
      });

      let documentText = '';
      try {
        documentText = await extractTextFromPdfBuffer(fileBuffer);
      } catch (error) {
        console.warn('[BFF] contract pdf text extraction failed:', error);
      }

      const analysis = await projectRequestContractAiService.analyzeContract({
        fileName,
        documentText: documentText || fileName,
      });

      res.status(200).json({ contractDocument, analysis });
    }),
  );

  app.post('/api/v1/project-requests/:requestId/notify-registration', createMutatingRoute(idempotencyService, async (req) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, PROJECT_REQUEST_ROUTE_ROLES, 'notify project registration');
    const requestId = readOptionalText(req.params.requestId);

    if (!requestId) {
      throw createHttpError(400, 'project request id is required', 'missing_project_request_id');
    }

    if (!projectRegistrationSlackService?.enabled || typeof projectRegistrationSlackService.notifyMessage !== 'function') {
      return {
        status: 200,
        body: {
          ok: true,
          enabled: false,
          delivered: false,
          reason: 'slack_not_configured',
          requestId,
        },
      };
    }

    const requestSnap = await db.doc(`orgs/${tenantId}/projectRequests/${requestId}`).get();
    if (!requestSnap.exists) {
      throw createHttpError(404, `Project request not found: ${requestId}`, 'not_found');
    }

    const projectRequest = requestSnap.data() || {};
    await projectRegistrationSlackService.notifyMessage(buildProjectRegistrationSlackPayload(projectRequest));

    return {
      status: 200,
      body: {
        ok: true,
        enabled: true,
        delivered: true,
        requestId,
        projectId: readOptionalText(projectRequest.approvedProjectId) || null,
      },
    };
  }));

  // ── Evidence drive root (project-level) ─────────────────────────────────────
  app.post('/api/v1/projects/:projectId/evidence-drive/root/provision', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeProjectDrive, 'provision evidence drive root');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { projectId } = req.params;
    const timestamp = now();

    const project = await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    let folder;
    try {
      folder = await driveService.ensureProjectRootFolder({
        tenantId, projectId,
        projectName: project.name || projectId,
        existingFolderId: project.evidenceDriveRootFolderId,
      });
    } catch (error) {
      if (error instanceof DriveServiceError) throw createHttpError(error.statusCode, error.message, error.code);
      throw error;
    }

    const result = await mergeSystemManagedDoc({
      db,
      path: `orgs/${tenantId}/projects/${projectId}`,
      patch: {
        evidenceDriveSharedDriveId: folder.driveId || project.evidenceDriveSharedDriveId || undefined,
        evidenceDriveRootFolderId: folder.id,
        evidenceDriveRootFolderName: folder.name,
        evidenceDriveRootFolderLink: folder.webViewLink || undefined,
        evidenceDriveProvisionedAt: timestamp,
      },
      tenantId,
      actorId,
      now: timestamp,
      notFoundMessage: `Project not found: ${projectId}`,
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'project',
      entityId: projectId,
      action: 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `프로젝트 증빙 루트 폴더 연결: ${folder.name}`,
      metadata: { source: 'bff', folderId: folder.id, folderName: folder.name, driveId: folder.driveId || null },
      timestamp,
    });

    return {
      status: 200,
      body: {
        projectId,
        folderId: folder.id,
        folderName: folder.name,
        webViewLink: folder.webViewLink || null,
        sharedDriveId: folder.driveId || null,
        version: result.version,
        updatedAt: result.data.updatedAt,
      },
    };
  }));

  app.post('/api/v1/projects/:projectId/evidence-drive/root/link', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeProjectDrive, 'link evidence drive root');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { projectId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(projectDriveRootLinkSchema, req.body, 'Invalid evidence drive root payload');
    const folderId = extractDriveFolderId(parsed.value);

    if (!folderId) {
      throw createHttpError(400, 'Google Drive 폴더 링크 또는 폴더 ID를 입력해 주세요.', 'invalid_drive_folder_link');
    }

    const project = await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    let folder;
    try {
      folder = await driveService.getFile(folderId);
    } catch (error) {
      if (error instanceof DriveServiceError) throw createHttpError(error.statusCode, error.message, error.code);
      throw error;
    }

    if (!folder) {
      throw createHttpError(404, `Google Drive 폴더를 찾을 수 없습니다: ${folderId}`, 'drive_folder_not_found');
    }
    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      throw createHttpError(400, '입력한 링크가 폴더가 아닙니다. Shared Drive 폴더 링크를 입력해 주세요.', 'drive_folder_required');
    }

    const result = await mergeSystemManagedDoc({
      db,
      path: `orgs/${tenantId}/projects/${projectId}`,
      patch: {
        evidenceDriveSharedDriveId: folder.driveId || project.evidenceDriveSharedDriveId || undefined,
        evidenceDriveRootFolderId: folder.id,
        evidenceDriveRootFolderName: folder.name,
        evidenceDriveRootFolderLink: folder.webViewLink || parsed.value,
        evidenceDriveProvisionedAt: timestamp,
      },
      tenantId,
      actorId,
      now: timestamp,
      notFoundMessage: `Project not found: ${projectId}`,
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'project',
      entityId: projectId,
      action: 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `프로젝트 증빙 루트 폴더 수동 연결: ${folder.name}`,
      metadata: { source: 'bff', folderId: folder.id, folderName: folder.name, driveId: folder.driveId || null, inputValue: parsed.value },
      timestamp,
    });

    return {
      status: 200,
      body: {
        projectId,
        folderId: folder.id,
        folderName: folder.name,
        webViewLink: folder.webViewLink || parsed.value,
        sharedDriveId: folder.driveId || null,
        version: result.version,
        updatedAt: result.data.updatedAt,
      },
    };
  }));
}
