import express from 'express';
import { createOutboxEvent } from '../outbox.mjs';
import {
  DriveServiceError,
  extractDriveFolderId,
} from '../google-drive.mjs';
import { GoogleSheetsServiceError } from '../google-sheets.mjs';
import { extractTextFromPdfBuffer } from '../pdf-text.mjs';
import { normalizeProjectRevenueFields } from '../project-financials.mjs';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed,
  ROUTE_ROLES, PROJECT_REQUEST_ROUTE_ROLES, createHttpError, encryptAuditEmail,
  parseLimit, parseCursor, buildListResponse,
  ensureDocumentExists, upsertVersionedDoc, mergeSystemManagedDoc,
  stripServerManagedFields, stripExpectedVersion, stripUndefinedDeep, readOptionalText, decodeHeaderValue,
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
  projectRestoreSchema,
  projectTrashSchema,
  projectExecutiveReviewSchema,
  projectExecutiveResubmitSchema,
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

const PROJECT_TYPE_SLACK_LABELS = {
  C1: 'C-1 컨설팅',
  A1: 'A-1 액셀러레이팅 - 국내일반',
  A2: 'A-2 액셀러레이팅 - 글로벌',
  I1: 'I-1 투자조합운용',
  I2: 'I-2 투자조합운용 - GP관리보수',
  I3: 'I-3 투자조합운용 - LP수익',
  D1: 'D-1 개발협력사업 - AVPN 포함',
  S1: 'S-1 공간사업 - 메리히어',
  S2: 'S-2 공간사업 - 공간운영 용역사업',
  E1: 'E-1 교육사업 - 단기 워크숍 등',
  P1: 'P-1 출판사업',
  Z1: 'Z-1 기타사업',
};

export function formatProjectTypeSlackLabel(value) {
  const normalized = normalizeProjectType(readOptionalText(value));
  return PROJECT_TYPE_SLACK_LABELS[normalized] || normalized;
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
    '*[InnerPlatform] 프로젝트 등록 요청 접수*',
    `프로젝트명: \`${projectName}\``,
    `공식 계약명: ${officialContractName}`,
    `계약 대상: ${clientOrg}`,
    `담당조직(CIC): ${department}`,
    `PM: ${managerName}`,
    `팀/인력: ${teamName}`,
    `계약 기간: ${formatProjectPeriod(payload.contractStart, payload.contractEnd)}`,
    `계약금액: ${formatOptionalProjectAmount(payload.contractAmount, financialInputFlags.contractAmount)}`,
    `프로젝트 목적: ${purpose}`,
    `요청자: ${requester} (${requesterEmail})`,
    `projectId: \`${projectId}\``,
  ];

  return {
    text: `[InnerPlatform] 프로젝트 등록 요청 접수: ${projectName}`,
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
    '*[InnerPlatform] 프로젝트 등록 완료*',
    `프로젝트명: \`${projectName}\``,
    `공식 계약명: ${officialContractName}`,
    `계약 대상: ${clientOrg}`,
    `담당조직(CIC): ${department}`,
    `프로젝트 유형: ${formatProjectTypeSlackLabel(payload.type)}`,
    `PM: ${managerName}`,
    `팀/인력: ${teamName}`,
    `계약 기간: ${formatProjectPeriod(payload.contractStart, payload.contractEnd)}`,
    `계약금액: ${formatOptionalProjectAmount(payload.contractAmount, financialInputFlags.contractAmount)}`,
    `프로젝트 목적: ${purpose}`,
    `등록자: ${actorId} (${actorEmail})`,
    `tenantId: \`${tenantId}\``,
    `projectId: \`${projectId}\``,
  ];

  return {
    text: `[InnerPlatform] 프로젝트 등록 완료: ${projectName}`,
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

function formatExecutiveReviewSlackLabel(status) {
  if (status === 'APPROVED') return '승인 완료';
  if (status === 'REVISION_REJECTED') return '수정 요청 후 반려';
  if (status === 'DUPLICATE_DISCARDED') return '중복·폐기';
  return '검토 대기';
}

function buildProjectExecutiveReviewSlackPayload({ project, projectRequest, reviewStatus, reviewComment, reviewerName }) {
  const payload = project && typeof project === 'object' ? project : {};
  const requestPayload = projectRequest?.payload && typeof projectRequest.payload === 'object'
    ? projectRequest.payload
    : {};
  const projectName = trimSlackText(payload.name || requestPayload.name, 120);
  const officialContractName = trimSlackText(payload.officialContractName || requestPayload.officialContractName, 220);
  const clientOrg = trimSlackText(payload.clientOrg || requestPayload.clientOrg, 160);
  const department = trimSlackText(payload.department || requestPayload.department, 120);
  const requester = trimSlackText(projectRequest?.requestedByName, 120);
  const requestId = trimSlackText(projectRequest?.id, 120);
  const projectId = trimSlackText(payload.id, 120);
  const decisionLabel = formatExecutiveReviewSlackLabel(reviewStatus);
  const reason = trimSlackText(reviewComment, 280);
  const reviewer = trimSlackText(reviewerName, 120);
  const lines = [
    '*[InnerPlatform] CIC 대표 검토 결과*',
    `프로젝트명: \`${projectName}\``,
    `공식 계약명: ${officialContractName}`,
    `계약 대상: ${clientOrg}`,
    `담당조직(CIC): ${department}`,
    `결정: ${decisionLabel}`,
    `사유: ${reason}`,
    `검토자: ${reviewer}`,
    `요청자: ${requester}`,
    `requestId: \`${requestId}\``,
    `projectId: \`${projectId}\``,
  ];

  return {
    text: `[InnerPlatform] CIC 대표 검토 결과: ${decisionLabel} · ${projectName}`,
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

function assertProjectRequestMatchesProject(request, projectId) {
  const requestProjectId = readOptionalText(request?.approvedProjectId);
  const normalizedProjectId = readOptionalText(projectId);
  if (requestProjectId && normalizedProjectId && requestProjectId !== normalizedProjectId) {
    throw createHttpError(
      409,
      `Project request does not belong to project: ${requestProjectId} != ${normalizedProjectId}`,
      'request_project_mismatch',
    );
  }
}

export async function resolveProjectRequestDocuments({ db, tenantId, requestId, projectId }) {
  const refs = [];
  const addRef = (ref) => {
    if (!refs.some((existing) => existing.path === ref.path)) refs.push(ref);
  };

  let request = null;
  let resolvedRequestId = readOptionalText(requestId);

  if (resolvedRequestId) {
    for (const collectionName of ['project_requests', 'projectRequests']) {
      const ref = db.doc(`orgs/${tenantId}/${collectionName}/${resolvedRequestId}`);
      const snap = await ref.get();
      if (snap.exists) {
        addRef(ref);
        request = request || { id: resolvedRequestId, ...(snap.data() || {}) };
      }
    }
    if (!request) {
      throw createHttpError(404, `Project request not found: ${resolvedRequestId}`, 'not_found');
    }
    assertProjectRequestMatchesProject(request, projectId);
    return { request, requestId: resolvedRequestId, refs };
  }

  for (const collectionName of ['project_requests', 'projectRequests']) {
    const baseQuery = db.collection(`orgs/${tenantId}/${collectionName}`)
      .where('approvedProjectId', '==', projectId);
    let querySnap = await baseQuery.orderBy('requestedAt', 'desc').limit(1).get();
    if (querySnap.empty) {
      querySnap = await baseQuery.limit(1).get();
    }
    if (!querySnap.empty) {
      const snap = querySnap.docs[0];
      addRef(snap.ref);
      resolvedRequestId = snap.id;
      request = { id: snap.id, ...(snap.data() || {}) };
      assertProjectRequestMatchesProject(request, projectId);
      break;
    }
  }

  if (resolvedRequestId) {
    addRef(db.doc(`orgs/${tenantId}/project_requests/${resolvedRequestId}`));
  }

  return { request, requestId: resolvedRequestId || null, refs };
}

export async function mergeProjectAndRequestDocs({
  db,
  projectPath,
  buildProjectPatch,
  buildRequestPatch,
  requestRefs,
  tenantId,
  actorId,
  now,
  notFoundMessage,
}) {
  const projectRef = db.doc(projectPath);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(projectRef);
    if (!snap.exists) throw createHttpError(404, notFoundMessage || `Document not found: ${projectPath}`, 'not_found');

    const current = snap.data() || {};
    const currentVersion = Number.isInteger(current.version) && current.version > 0 ? current.version : 1;
    const nextVersion = currentVersion + 1;
    const projectPatch = buildProjectPatch(current);
    const document = {
      ...current, ...projectPatch, tenantId, version: nextVersion,
      createdBy: current.createdBy || actorId, createdAt: current.createdAt || now,
      updatedBy: actorId, updatedAt: now,
    };
    const sanitizedProject = stripUndefinedDeep(document);
    tx.set(projectRef, sanitizedProject, { merge: true });

    const requestPatch = buildRequestPatch?.(current) || null;
    if (requestPatch) {
      const sanitizedRequestPatch = stripUndefinedDeep(requestPatch);
      for (const ref of requestRefs) {
        tx.set(ref, sanitizedRequestPatch, { merge: true });
      }
    }

    return { version: nextVersion, data: sanitizedProject };
  });
}

export async function readProjectRequestById(db, tenantId, requestId) {
  const normalizedRequestId = readOptionalText(requestId);
  if (!normalizedRequestId) return null;
  for (const collectionName of ['project_requests', 'projectRequests']) {
    const snap = await db.doc(`orgs/${tenantId}/${collectionName}/${normalizedRequestId}`).get();
    if (snap.exists) {
      return { id: normalizedRequestId, ...(snap.data() || {}) };
    }
  }
  return null;
}

function formatProjectRequestTeamMember(member) {
  const name = readOptionalText(member?.memberName);
  const nickname = readOptionalText(member?.memberNickname);
  const role = readOptionalText(member?.role);
  const participationRate = Number.isFinite(Number(member?.participationRate))
    ? Math.max(0, Math.round(Number(member.participationRate)))
    : 0;
  const laborAllocationStartMonth = normalizeMonth(member?.laborAllocationStartMonth);
  const laborAllocationEndMonth = normalizeMonth(member?.laborAllocationEndMonth);
  const identity = nickname || name || '-';
  const rolePart = role ? ` · ${role}` : '';
  const ratePart = participationRate > 0 ? ` · ${participationRate}%` : '';
  const periodPart = laborAllocationStartMonth || laborAllocationEndMonth
    ? ` · 인건비 ${laborAllocationStartMonth || '-'}~${laborAllocationEndMonth || '-'}`
    : '';
  return `${identity}${rolePart}${ratePart}${periodPart}`;
}

function normalizeProjectContractType(value) {
  const text = readOptionalText(value);
  if (!text) return '계약서(날인)';
  if (text === '계약서') return '계약서(날인)';
  if (text === '협약서') return '협약서(날인)';
  if (text === '발주기관 전자시스템') return '전자계약 시스템';
  if (text === '일반') return '기타';
  return text;
}

function normalizeProjectStatus(value) {
  return ['CONTRACT_PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED_PENDING_PAYMENT'].includes(value)
    ? value
    : 'CONTRACT_PENDING';
}

function normalizeProjectPhase(value) {
  return value === 'PROSPECT' || value === 'CONFIRMED' ? value : 'CONFIRMED';
}

function normalizeProjectType(value) {
  return ['C1', 'A1', 'A2', 'I1', 'I2', 'I3', 'D1', 'S1', 'S2', 'E1', 'P1', 'Z1'].includes(value)
    ? value
    : 'D1';
}

function normalizeSettlementType(value) {
  return ['TYPE1', 'TYPE2', 'TYPE3', 'TYPE4', 'TYPE5'].includes(value) ? value : 'NONE';
}

function normalizeBasis(value) {
  if (value === 'SUPPLY_AMOUNT' || value === '공급가액') return '공급가액';
  if (value === 'SUPPLY_PRICE' || value === '공급대가') return '공급대가';
  return 'NONE';
}

function normalizeAccountType(value) {
  return value === 'DEDICATED' || value === 'OPERATING' ? value : 'NONE';
}

function normalizeProjectFundInputMode(value) {
  return value === 'DIRECT_ENTRY' ? 'DIRECT_ENTRY' : 'BANK_UPLOAD';
}

function normalizeProjectCurrency(value) {
  return value === 'USD' ? 'USD' : 'KRW';
}

function buildProjectRequestPayloadFromProject(project, existingPayload = {}) {
  const teamMembersDetailed = Array.isArray(project?.teamMembersDetailed) && project.teamMembersDetailed.length > 0
    ? project.teamMembersDetailed
    : (Array.isArray(existingPayload.teamMembersDetailed) ? existingPayload.teamMembersDetailed : []);
  const teamMembers = teamMembersDetailed.length > 0
    ? teamMembersDetailed.map(formatProjectRequestTeamMember).join(', ')
    : readOptionalText(existingPayload.teamMembers);
  const hasProjectField = (key) => Object.prototype.hasOwnProperty.call(project || {}, key);
  const pickText = (key) => hasProjectField(key)
    ? readOptionalText(project?.[key])
    : readOptionalText(existingPayload[key]);
  const pickValue = (key) => hasProjectField(key) ? project?.[key] : existingPayload[key];
  const pickNumber = (key) => Number.isFinite(project?.[key]) ? project[key] : existingPayload[key];

  return {
    ...(existingPayload && typeof existingPayload === 'object' ? existingPayload : {}),
    name: pickText('name'),
    officialContractName: pickText('officialContractName'),
    type: normalizeProjectType(pickText('type')),
    status: normalizeProjectStatus(pickText('status')),
    phase: normalizeProjectPhase(pickText('phase')),
    description: pickText('description'),
    clientOrg: pickText('clientOrg'),
    department: pickText('department'),
    groupwareName: pickText('groupwareName'),
    currency: normalizeProjectCurrency(pickText('currency')),
    contractAmount: pickNumber('contractAmount'),
    salesVatAmount: pickNumber('salesVatAmount'),
    totalRevenueAmount: pickNumber('totalRevenueAmount'),
    supportAmount: pickNumber('supportAmount'),
    financialInputFlags: project?.financialInputFlags || existingPayload.financialInputFlags || undefined,
    contractStart: pickText('contractStart'),
    contractEnd: pickText('contractEnd'),
    contractType: normalizeProjectContractType(pickText('contractType')),
    settlementType: normalizeSettlementType(pickText('settlementType')),
    basis: normalizeBasis(pickText('basis')),
    accountType: normalizeAccountType(pickText('accountType')),
    fundInputMode: normalizeProjectFundInputMode(pickText('fundInputMode')),
    settlementSheetPolicy: pickValue('settlementSheetPolicy') || undefined,
    paymentPlan: pickValue('paymentPlan') || { contract: 0, interim: 0, final: 0 },
    paymentPlanDesc: pickText('paymentPlanDesc'),
    settlementGuide: pickText('settlementGuide'),
    finalPaymentNote: pickText('finalPaymentNote'),
    projectPurpose: pickText('projectPurpose'),
    managerId: pickText('managerId'),
    managerName: pickText('managerName'),
    teamName: pickText('teamName'),
    teamMembers,
    teamMembersDetailed,
    participantCondition: pickText('participantCondition'),
    note: readOptionalText(existingPayload.note),
    contractDocument: project?.contractDocument ?? existingPayload.contractDocument ?? null,
    contractAnalysis: project?.contractAnalysis ?? existingPayload.contractAnalysis ?? null,
  };
}

function normalizeParticipationRate(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeMonth(value) {
  const text = readOptionalText(value);
  return /^\d{4}-\d{2}$/.test(text) ? text : '';
}

function normalizeProjectTeamMembersDetailed(value) {
  return (Array.isArray(value) ? value : [])
    .map((member) => {
      const normalized = {
        memberName: readOptionalText(member?.memberName),
        memberNickname: readOptionalText(member?.memberNickname),
        role: readOptionalText(member?.role),
        participationRate: normalizeParticipationRate(member?.participationRate),
      };
      const laborAllocationStartMonth = normalizeMonth(member?.laborAllocationStartMonth);
      const laborAllocationEndMonth = normalizeMonth(member?.laborAllocationEndMonth);
      if (laborAllocationStartMonth) normalized.laborAllocationStartMonth = laborAllocationStartMonth;
      if (laborAllocationEndMonth) normalized.laborAllocationEndMonth = laborAllocationEndMonth;
      return normalized;
    })
    .filter((member) => (
      member.memberName
      || member.memberNickname
      || member.role
      || member.participationRate > 0
      || member.laborAllocationStartMonth
      || member.laborAllocationEndMonth
    ));
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
      periodStart: member.laborAllocationStartMonth || readOptionalText(project.contractStart).slice(0, 7),
      periodEnd: member.laborAllocationEndMonth || readOptionalText(project.contractEnd).slice(0, 7),
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

    const projectPayload = normalizeProjectRevenueFields({
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: parsed.id.trim(),
      name: parsed.name.trim(),
      orgId: tenantId,
      currency: normalizeProjectCurrency(parsed.currency),
      teamMembersDetailed: normalizeProjectTeamMembersDetailed(parsed.teamMembersDetailed),
    }, 'totalRevenueAmount');

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

    const projectRequest = await readProjectRequestById(db, tenantId, requestId);
    if (!projectRequest) {
      throw createHttpError(404, `Project request not found: ${requestId}`, 'not_found');
    }

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

  app.post('/api/v1/projects/:projectId/executive-review', createMutatingRoute(idempotencyService, async (req) => {
    const { tenantId, actorId, actorEmail } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'review project executive status');
    const projectId = readOptionalText(req.params.projectId);
    if (!projectId) {
      throw createHttpError(400, 'project id is required', 'missing_project_id');
    }

    const parsed = parseWithSchema(projectExecutiveReviewSchema, req.body, 'Invalid executive review payload');
    const projectPath = `orgs/${tenantId}/projects/${projectId}`;
    const reviewerName = readOptionalText(parsed.reviewerName) || readOptionalText(actorEmail) || actorId;
    const now = new Date().toISOString();
    await ensureDocumentExists(db, projectPath, `Project not found: ${projectId}`);
    const { request, requestId: resolvedRequestId, refs } = await resolveProjectRequestDocuments({
      db,
      tenantId,
      requestId: parsed.requestId,
      projectId,
    });

    const projectResult = await mergeProjectAndRequestDocs({
      db,
      projectPath,
      buildProjectPatch: (currentProject) => {
        const previousStatus = readOptionalText(currentProject.executiveReviewStatus) || 'PENDING';
        const currentHistory = Array.isArray(currentProject.executiveReviewHistory) ? currentProject.executiveReviewHistory : [];
        return {
          executiveReviewStatus: parsed.reviewStatus,
          executiveReviewedAt: now,
          executiveReviewedById: actorId,
          executiveReviewedByName: reviewerName,
          executiveReviewComment: readOptionalText(parsed.reviewComment) || null,
          executiveReviewHistory: [
            ...currentHistory,
            {
              status: parsed.reviewStatus,
              previousStatus,
              reviewedAt: now,
              reviewedById: actorId,
              reviewedByName: reviewerName,
              reviewComment: readOptionalText(parsed.reviewComment) || null,
            },
          ],
        };
      },
      buildRequestPatch: () => resolvedRequestId ? ({
        status: parsed.reviewStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reviewOutcome: parsed.reviewStatus,
        reviewedBy: actorId,
        reviewedByName: reviewerName,
        reviewedAt: now,
        reviewComment: readOptionalText(parsed.reviewComment) || null,
        rejectedReason: parsed.reviewStatus === 'APPROVED' ? null : (readOptionalText(parsed.reviewComment) || null),
        approvedProjectId: projectId,
        updatedAt: now,
      }) : null,
      requestRefs: resolvedRequestId ? refs : [],
      tenantId,
      actorId,
      now,
      notFoundMessage: `Project not found: ${projectId}`,
    });

    let slackDelivered = false;
    let slackReason = null;
    if (!projectRegistrationSlackService?.enabled || typeof projectRegistrationSlackService.notifyMessage !== 'function') {
      slackReason = 'slack_not_configured';
    } else {
      try {
        await projectRegistrationSlackService.notifyMessage(buildProjectExecutiveReviewSlackPayload({
          project: projectResult.data,
          projectRequest: request,
          reviewStatus: parsed.reviewStatus,
          reviewComment: parsed.reviewComment,
          reviewerName,
        }));
        slackDelivered = true;
      } catch (error) {
        console.error('[BFF] executive review Slack notification failed:', error);
        slackReason = error instanceof Error ? error.message : 'slack_delivery_failed';
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        projectId,
        requestId: resolvedRequestId || null,
        reviewStatus: parsed.reviewStatus,
        reviewedAt: now,
        slackDelivered,
        slackReason,
      },
    };
  }));

  app.post('/api/v1/projects/:projectId/executive-review/resubmit', createMutatingRoute(idempotencyService, async (req) => {
    const { tenantId, actorId, actorEmail } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'resubmit project for executive review');
    const projectId = readOptionalText(req.params.projectId);
    if (!projectId) {
      throw createHttpError(400, 'project id is required', 'missing_project_id');
    }

    const parsed = parseWithSchema(projectExecutiveResubmitSchema, req.body, 'Invalid executive resubmit payload');
    const projectPath = `orgs/${tenantId}/projects/${projectId}`;
    const reviewerName = readOptionalText(parsed.reviewerName) || readOptionalText(actorEmail) || actorId;
    const now = new Date().toISOString();
    await ensureDocumentExists(db, projectPath, `Project not found: ${projectId}`);
    const { request, requestId: resolvedRequestId, refs } = await resolveProjectRequestDocuments({
      db,
      tenantId,
      requestId: parsed.requestId,
      projectId,
    });

    await mergeProjectAndRequestDocs({
      db,
      projectPath,
      buildProjectPatch: (currentProject) => {
        const previousStatus = readOptionalText(currentProject.executiveReviewStatus) || 'PENDING';
        const currentHistory = Array.isArray(currentProject.executiveReviewHistory) ? currentProject.executiveReviewHistory : [];
        return {
          executiveReviewStatus: 'PENDING',
          executiveReviewedAt: now,
          executiveReviewedById: actorId,
          executiveReviewedByName: reviewerName,
          executiveReviewComment: readOptionalText(parsed.reviewComment) || null,
          executiveReviewHistory: [
            ...currentHistory,
            {
              status: 'PENDING',
              previousStatus,
              reviewedAt: now,
              reviewedById: actorId,
              reviewedByName: reviewerName,
              reviewComment: readOptionalText(parsed.reviewComment) || null,
            },
          ],
        };
      },
      buildRequestPatch: (currentProject) => resolvedRequestId ? ({
        status: 'PENDING',
        reviewOutcome: null,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
        reviewComment: null,
        rejectedReason: null,
        approvedProjectId: projectId,
        payload: buildProjectRequestPayloadFromProject(currentProject, request?.payload || {}),
        updatedAt: now,
      }) : null,
      requestRefs: resolvedRequestId ? refs : [],
      tenantId,
      actorId,
      now,
      notFoundMessage: `Project not found: ${projectId}`,
    });

    return {
      status: 200,
      body: {
        ok: true,
        projectId,
        requestId: resolvedRequestId || null,
        reviewStatus: 'PENDING',
        reviewedAt: now,
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
