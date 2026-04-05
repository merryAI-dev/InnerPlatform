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
  settlementKernelDeriveSchema,
  settlementKernelActualSyncSchema,
  settlementKernelFlowSnapshotSchema,
  projectSheetSourceUploadSchema,
  projectRequestContractAnalyzeSchema,
  projectRequestContractUploadSchema,
  projectDriveRootLinkSchema,
  projectRestoreSchema,
  projectTrashSchema,
} from '../schemas.mjs';
import { createSettlementKernelService } from '../settlement-kernel.mjs';

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

function normalizeParticipationRate(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeProjectTeamMembersDetailed(value) {
  return (Array.isArray(value) ? value : [])
    .map((member) => ({
      memberName: readOptionalText(member?.memberName),
      memberNickname: readOptionalText(member?.memberNickname),
      role: readOptionalText(member?.role),
      participationRate: normalizeParticipationRate(member?.participationRate),
    }))
    .filter((member) => member.memberName || member.memberNickname || member.role || member.participationRate > 0);
}

function normalizeSyncKeySegment(value, fallback = 'na') {
  const normalized = String(value || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function buildProjectTeamMemberSyncKey(member) {
  return [
    normalizeSyncKeySegment(member.memberNickname || member.memberName, 'member'),
    normalizeSyncKeySegment(member.role, 'role'),
  ].join('__');
}

export function resolveProjectTeamMemberLookupKeys(member) {
  return Array.from(new Set([
    readOptionalText(member?.memberNickname),
    readOptionalText(member?.memberName),
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase())));
}

export async function tryRenameManagedProjectRootFolder({
  driveService,
  projectId,
  projectName,
  existingFolderId,
  logger = console,
}) {
  if (
    !driveService
    || typeof driveService.renameManagedProjectRootFolder !== 'function'
    || !readOptionalText(existingFolderId)
  ) {
    return null;
  }

  try {
    return await driveService.renameManagedProjectRootFolder({
      projectId,
      projectName,
      existingFolderId,
    });
  } catch (error) {
    logger.error('[BFF] managed project root rename skipped:', error);
    return null;
  }
}

export async function tryEnsureProjectRootFolder({
  driveService,
  tenantId,
  projectId,
  projectName,
  existingFolderId,
  logger = console,
}) {
  if (
    !driveService
    || typeof driveService.ensureProjectRootFolder !== 'function'
  ) {
    return null;
  }

  try {
    return await driveService.ensureProjectRootFolder({
      tenantId,
      projectId,
      projectName,
      existingFolderId,
    });
  } catch (error) {
    logger.error('[BFF] managed project root provision skipped:', error);
    return null;
  }
}

function resolveParticipationSettlementSystem(project) {
  if (project?.settlementType === 'TYPE5' || project?.accountType === 'DEDICATED') {
    return 'E_NARA_DOUM';
  }
  if (project?.settlementType === 'NONE' && project?.accountType === 'NONE') {
    return 'NONE';
  }
  return 'PRIVATE';
}

async function syncProjectParticipationEntries({
  db,
  tenantId,
  project,
  now,
}) {
  const teamMembers = normalizeProjectTeamMembersDetailed(project?.teamMembersDetailed);
  const partEntriesRef = db.collection(`orgs/${tenantId}/partEntries`);
  const existingSnap = await partEntriesRef.where('projectId', '==', project.id).get();
  const existingSyncEntries = existingSnap.docs.filter((doc) => doc.data()?.source === 'PROJECT_TEAM_SYNC');

  const memberSnap = await db.collection(`orgs/${tenantId}/members`).get();
  const members = memberSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const memberByIdentity = new Map();
  for (const member of members) {
    for (const key of [
      readOptionalText(member?.nickname),
      readOptionalText(member?.name),
    ]) {
      if (!key) continue;
      memberByIdentity.set(key.toLowerCase(), member);
    }
  }

  const desiredEntries = new Map();
  for (const member of teamMembers) {
    if (!member.role || (!member.memberName && !member.memberNickname)) continue;
    const matchedMember = resolveProjectTeamMemberLookupKeys(member)
      .map((lookupKey) => memberByIdentity.get(lookupKey))
      .find(Boolean);
    const memberId = readOptionalText(matchedMember?.uid || matchedMember?.id)
      || `project-team:${buildProjectTeamMemberSyncKey(member)}`;
    const displayName = readOptionalText(matchedMember?.name) || member.memberNickname || member.memberName;
    const key = buildProjectTeamMemberSyncKey(member);
    const entryId = `pte-${project.id}-${key}`;
    desiredEntries.set(entryId, {
      id: entryId,
      memberId,
      memberName: displayName,
      projectId: project.id,
      projectName: project.name,
      projectShortName: readOptionalText(project.shortName) || undefined,
      rate: member.participationRate,
      settlementSystem: resolveParticipationSettlementSystem(project),
      clientOrg: readOptionalText(project.clientOrg),
      periodStart: readOptionalText(project.contractStart).slice(0, 7),
      periodEnd: readOptionalText(project.contractEnd).slice(0, 7),
      isDocumentOnly: false,
      note: member.role,
      source: 'PROJECT_TEAM_SYNC',
      projectTeamMemberKey: key,
      updatedAt: now,
    });
  }

  const batch = db.batch();
  for (const [entryId, entry] of desiredEntries.entries()) {
    batch.set(partEntriesRef.doc(entryId), {
      ...entry,
      tenantId,
    }, { merge: true });
  }
  for (const doc of existingSyncEntries) {
    if (desiredEntries.has(doc.id)) continue;
    batch.delete(doc.ref);
  }
  if (desiredEntries.size > 0 || existingSyncEntries.length > 0) {
    await batch.commit();
  }
}

async function updateProjectTrashState({
  db,
  tenantId,
  projectId,
  actorId,
  actorEmail,
  now,
  expectedVersion,
  patch,
}) {
  const ref = db.doc(`orgs/${tenantId}/projects/${projectId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw createHttpError(404, `Project not found: ${projectId}`, 'not_found');
    }

    const current = snap.data() || {};
    const currentVersion = Number.isInteger(current.version) && current.version > 0 ? current.version : 1;
    if (expectedVersion !== currentVersion) {
      throw createHttpError(409, `Version mismatch: expected ${expectedVersion}, actual ${currentVersion}`, 'version_conflict');
    }

    const document = {
      ...current,
      ...patch,
      tenantId,
      version: currentVersion + 1,
      createdBy: current.createdBy || actorId,
      createdAt: current.createdAt || now,
      updatedBy: actorId,
      updatedAt: now,
    };

    tx.set(ref, document, { merge: true });
    return { version: currentVersion + 1, data: document };
  });
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
  settlementKernelService = createSettlementKernelService(),
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
    const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.id.trim()}`);
    const existingProjectSnap = await projectRef.get();
    const existingProject = existingProjectSnap.exists ? (existingProjectSnap.data() || {}) : null;

    const projectPayload = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: parsed.id.trim(),
      name: parsed.name.trim(),
      orgId: tenantId,
      teamMembersDetailed: normalizeProjectTeamMembersDetailed(parsed.teamMembersDetailed),
    };

    const shouldProvisionProjectDriveRoot = !!(
      driveService
      && typeof driveService.ensureProjectRootFolder === 'function'
      && (driveConfig ? driveConfig.enabled && driveConfig.defaultParentFolderId : true)
      && !projectPayload.evidenceDriveRootFolderId
    );

    if (shouldProvisionProjectDriveRoot) {
      const folder = await tryEnsureProjectRootFolder({
        driveService,
        tenantId,
        projectId: projectPayload.id,
        projectName: projectPayload.name || projectPayload.id,
        existingFolderId: projectPayload.evidenceDriveRootFolderId,
      });
      if (folder) {
        projectPayload.evidenceDriveSharedDriveId = folder.driveId || projectPayload.evidenceDriveSharedDriveId || undefined;
        projectPayload.evidenceDriveRootFolderId = folder.id;
        projectPayload.evidenceDriveRootFolderName = folder.name;
        projectPayload.evidenceDriveRootFolderLink = folder.webViewLink || projectPayload.evidenceDriveRootFolderLink || undefined;
        projectPayload.evidenceDriveProvisionedAt = timestamp;
      }
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

    if (Array.isArray(projectPayload.teamMembersDetailed)) {
      await syncProjectParticipationEntries({
        db,
        tenantId,
        project: result.data,
        now: timestamp,
      });
    }

    const existingName = readOptionalText(existingProject?.name);
    const renamedProjectRoot = (
      !result.created
      && existingName
      && existingName !== projectPayload.name
    )
      ? await tryRenameManagedProjectRootFolder({
        driveService,
        projectId: projectPayload.id,
        projectName: projectPayload.name,
        existingFolderId: result.data.evidenceDriveRootFolderId,
      })
      : null;

    if (renamedProjectRoot?.name && renamedProjectRoot.name !== readOptionalText(result.data.evidenceDriveRootFolderName)) {
      const renamed = await mergeSystemManagedDoc({
        db,
        path: `orgs/${tenantId}/projects/${projectPayload.id}`,
        patch: {
          evidenceDriveRootFolderName: renamedProjectRoot.name,
          evidenceDriveRootFolderLink: renamedProjectRoot.webViewLink || undefined,
        },
        tenantId,
        actorId,
        now: timestamp,
        notFoundMessage: `Project not found: ${projectPayload.id}`,
      });
      result.version = renamed.version;
      result.data = renamed.data;
    }

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

  app.post('/api/v1/projects/:projectId/trash', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'trash project');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { projectId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(projectTrashSchema, req.body, 'Invalid project trash payload');
    const result = await updateProjectTrashState({
      db,
      tenantId,
      projectId,
      actorId,
      actorEmail,
      now: timestamp,
      expectedVersion: parsed.expectedVersion,
      patch: {
        trashedAt: timestamp,
        trashedById: actorId,
        trashedByEmail: actorEmail || null,
        trashedReason: readOptionalText(parsed.reason) || null,
      },
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'project',
      entityId: projectId,
      action: 'TRASH',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `프로젝트 휴지통 이동: ${result.data.name || projectId}`,
      metadata: {
        source: 'bff',
        version: result.version,
        trashedAt: result.data.trashedAt,
        reason: result.data.trashedReason || null,
      },
      timestamp,
    });

    return {
      status: 200,
      body: {
        id: projectId,
        tenantId,
        version: result.version,
        updatedAt: result.data.updatedAt,
        trashedAt: result.data.trashedAt,
      },
    };
  }));

  app.post('/api/v1/projects/:projectId/restore', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'restore project');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { projectId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(projectRestoreSchema, req.body, 'Invalid project restore payload');
    const result = await updateProjectTrashState({
      db,
      tenantId,
      projectId,
      actorId,
      actorEmail,
      now: timestamp,
      expectedVersion: parsed.expectedVersion,
      patch: {
        trashedAt: null,
        trashedById: null,
        trashedByEmail: null,
        trashedReason: null,
      },
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'project',
      entityId: projectId,
      action: 'RESTORE',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `프로젝트 복구: ${result.data.name || projectId}`,
      metadata: {
        source: 'bff',
        version: result.version,
      },
      timestamp,
    });

    return {
      status: 200,
      body: {
        id: projectId,
        tenantId,
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

  app.post('/api/v1/projects/:projectId/settlement/derive', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'derive settlement rows');
    const { projectId } = req.params;
    const parsed = parseWithSchema(settlementKernelDeriveSchema, req.body, 'Invalid settlement derive payload');

    await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    if (!settlementKernelService?.isAvailable?.()) {
      throw createHttpError(503, 'Settlement kernel unavailable.', 'settlement_kernel_unavailable');
    }

    try {
      const derived = settlementKernelService.deriveRows(parsed);
      res.status(200).json(derived);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      const message = readOptionalText(error?.message) || 'Settlement kernel failed.';
      throw createHttpError(statusCode, message, error?.code || 'settlement_kernel_failed');
    }
  }));

  app.post('/api/v1/projects/:projectId/settlement/actual-sync-preview', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'preview settlement actual sync');
    const { projectId } = req.params;
    const parsed = parseWithSchema(settlementKernelActualSyncSchema, req.body, 'Invalid settlement actual sync payload');

    await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    if (!settlementKernelService?.isAvailable?.()) {
      throw createHttpError(503, 'Settlement kernel unavailable.', 'settlement_kernel_unavailable');
    }

    try {
      const preview = settlementKernelService.previewActualSync(parsed);
      res.status(200).json(preview);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      const message = readOptionalText(error?.message) || 'Settlement kernel failed.';
      throw createHttpError(statusCode, message, error?.code || 'settlement_kernel_failed');
    }
  }));

  app.post('/api/v1/projects/:projectId/settlement/flow-snapshot-preview', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'preview settlement flow snapshot');
    const { projectId } = req.params;
    const parsed = parseWithSchema(settlementKernelFlowSnapshotSchema, req.body, 'Invalid settlement flow snapshot payload');

    await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);

    if (!settlementKernelService?.isAvailable?.()) {
      throw createHttpError(503, 'Settlement kernel unavailable.', 'settlement_kernel_unavailable');
    }

    try {
      const preview = settlementKernelService.previewFlowSnapshot(parsed);
      res.status(200).json(preview);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      const message = readOptionalText(error?.message) || 'Settlement kernel failed.';
      throw createHttpError(statusCode, message, error?.code || 'settlement_kernel_failed');
    }
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
