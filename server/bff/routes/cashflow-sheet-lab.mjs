import { createHash, randomUUID } from 'node:crypto';
import {
  asyncHandler,
  createHttpError,
  ensureDocumentExists,
  readOptionalText,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { GoogleSheetsServiceError, extractSpreadsheetId } from '../google-sheets.mjs';
import { analyzeCashflowSheetTemplate, cashflowMappingKey, parseCashflowWeekLabel } from '../cashflow-sheet-template.mjs';
import { upsertCashflowWeekAmounts } from '../cashflow-canonical-store.mjs';
import { createJavaWeeklyClient } from '../java-weekly-client.mjs';
import {
  cashflowSheetLabApplySchema,
  cashflowSheetLabConfigSchema,
  cashflowSheetLabPreviewSchema,
  cashflowSheetLabWritebackApplySchema,
  cashflowSheetLabWritebackPreviewSchema,
  parseWithSchema,
} from '../schemas.mjs';

const CASHFLOW_SHEET_LAB_READ_RANGE = 'A1:ZZ220';
const DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS = 15_000;
const CASHFLOW_USAGE_SHEET_NAME_PARTS = ['cashflow', '사용내역', '연동'];
const CASHFLOW_WEEK_BASIS = 'sheet_range';
const CASHFLOW_WEEKS_COLLECTION_ID = 'cashflow_weeks';
const CASHFLOW_EVENTS_COLLECTION_ID = 'cashflow_events';
const CASHFLOW_CHANGE_CANDIDATES_COLLECTION_ID = 'cashflow_change_candidates';
const CASHFLOW_PROJECTION_SYNC_JOBS_COLLECTION_ID = 'cashflow_projection_sync_jobs';

function readEditSession(req) {
  const sessionId = readOptionalText(req.header('x-edit-session-id'));
  const leaseId = readOptionalText(req.header('x-edit-lease-id'));
  const fenceText = readOptionalText(req.header('x-edit-fence'));
  const fence = /^[1-9]\d*$/.test(fenceText) ? Number(fenceText) : Number.NaN;
  if (!sessionId || !leaseId || !Number.isSafeInteger(fence)) {
    throw createHttpError(400, 'Cashflow edit lease headers are required.', 'cashflow_edit_lease_request_invalid');
  }
  const finalizeText = readOptionalText(req.header('x-edit-finalize'));
  if (finalizeText && finalizeText !== 'true') {
    throw createHttpError(400, 'x-edit-finalize must be true when present.', 'cashflow_edit_lease_request_invalid');
  }
  return { sessionId, leaseId, fence, ...(finalizeText === 'true' ? { finalize: true } : {}) };
}

function javaCashflowSnapshot(result = {}) {
  const weeks = new Map();
  for (const [mode, lines] of [['projection', result.projection], ['actual', result.actual]]) {
    for (const line of Array.isArray(lines) ? lines : []) {
      const key = `${readOptionalText(line.yearMonth)}:${Number(line.weekNo)}`;
      const week = weeks.get(key) || {
        yearMonth: readOptionalText(line.yearMonth),
        weekNo: Number(line.weekNo),
        projection: {},
        actual: {},
      };
      week[mode][readOptionalText(line.cashflowLine)] = Number(line.amount);
      weeks.set(key, week);
    }
  }
  return { weeks: [...weeks.values()] };
}

function normalizeRole(value) {
  const normalized = readOptionalText(value).toLowerCase();
  return normalized === 'viewer' ? 'pm' : normalized;
}

function isWorkspaceUser(context, workspaceEmailDomain = 'mysc.co.kr') {
  const email = readOptionalText(context?.actorEmail).toLowerCase();
  const domain = readOptionalText(workspaceEmailDomain).replace(/^@+/, '').toLowerCase();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

function assertCashflowSheetLabAccess(req, workspaceEmailDomain = 'mysc.co.kr') {
  const actorRole = normalizeRole(req.context?.actorRole);
  if (isWorkspaceUser(req.context, workspaceEmailDomain)) return;
  if (['admin', 'finance_admin'].includes(actorRole)) return;
  throw createHttpError(
    403,
    `Workspace email is required to preview cashflow sheets lab: ${actorRole || 'unknown'}`,
    'forbidden',
  );
}

function normalizeRouteError(error) {
  if (error instanceof GoogleSheetsServiceError) {
    if (error.code === 'google_sheets_api_error' && [401, 403].includes(Number(error.statusCode))) {
      return createHttpError(
        403,
        'Google Sheet를 MYSC 시스템 서비스 계정에 공유해 주세요.',
        'google_sheet_service_account_forbidden',
      );
    }
    return createHttpError(error.statusCode, error.message, error.code);
  }
  return error;
}

function createDetailedHttpError(statusCode, message, code, details) {
  const error = createHttpError(statusCode, message, code);
  error.details = details;
  return error;
}

function logCashflowSheetLab(event, req, details = {}, level = 'info') {
  const write = typeof console[level] === 'function' ? console[level] : console.info;
  write('[CashflowSheetLab]', event, {
    requestId: req.context?.requestId || req.requestId || null,
    tenantId: req.context?.tenantId || null,
    actorId: req.context?.actorId || null,
    actorRole: req.context?.actorRole || null,
    ...details,
  });
}

function routeErrorDetails(error) {
  return {
    statusCode: error?.statusCode || 500,
    code: error?.code || error?.name || 'error',
    message: error?.message || 'Unknown error',
  };
}

function normalizeSheetFamilyName(value) {
  return readOptionalText(value).toLowerCase().replace(/\s+/g, '');
}

function isCashflowUsageLinkedSheetName(value) {
  const normalized = normalizeSheetFamilyName(value);
  return CASHFLOW_USAGE_SHEET_NAME_PARTS.every((part) => normalized.includes(part));
}

function findCashflowUsageLinkedSheet(sheets = []) {
  return sheets.find((sheet) => isCashflowUsageLinkedSheetName(sheet?.title)) || null;
}

function assertCashflowUsageLinkedSheet(preview) {
  if (isCashflowUsageLinkedSheetName(preview?.selectedSheetName)) return;
  throw createHttpError(
    400,
    'cashflow(사용내역 연동) 계열 시트 탭만 검토할 수 있습니다.',
    'cashflow_sheet_tab_unsupported',
  );
}

function projectDocPath(tenantId, projectId) {
  return `orgs/${tenantId}/projects/${projectId}`;
}

async function readProjectDocument(db, tenantId, projectId) {
  if (!db) return null;
  return ensureDocumentExists(db, projectDocPath(tenantId, projectId), `Project not found: ${projectId}`);
}

function readCashflowSheetLabConfig(project = {}) {
  const config = project?.cashflowSheetLab;
  if (!config || typeof config !== 'object') return null;
  const value = readOptionalText(config.value);
  if (!value) return null;
  return {
    value,
    sheetName: readOptionalText(config.sheetName),
    spreadsheetId: readOptionalText(config.spreadsheetId),
    spreadsheetTitle: readOptionalText(config.spreadsheetTitle),
    startWeek: readOptionalText(config.startWeek),
    endWeek: readOptionalText(config.endWeek),
    weekBasis: readOptionalText(config.weekBasis) || CASHFLOW_WEEK_BASIS,
    totalBasis: readOptionalText(config.totalBasis) || CASHFLOW_WEEK_BASIS,
    updatedAt: readOptionalText(config.updatedAt),
    updatedBy: config.updatedBy && typeof config.updatedBy === 'object' ? {
      uid: readOptionalText(config.updatedBy.uid),
      email: readOptionalText(config.updatedBy.email),
      role: readOptionalText(config.updatedBy.role),
    } : null,
    lastAppliedAt: readOptionalText(config.lastAppliedAt),
    lastAppliedBy: config.lastAppliedBy && typeof config.lastAppliedBy === 'object' ? {
      uid: readOptionalText(config.lastAppliedBy.uid),
      email: readOptionalText(config.lastAppliedBy.email),
      role: readOptionalText(config.lastAppliedBy.role),
    } : null,
    lastAppliedLineCount: Number.isFinite(Number(config.lastAppliedLineCount)) ? Number(config.lastAppliedLineCount) : undefined,
    lastProjectionLineCount: Number.isFinite(Number(config.lastProjectionLineCount)) ? Number(config.lastProjectionLineCount) : undefined,
    lastActualLineCount: Number.isFinite(Number(config.lastActualLineCount)) ? Number(config.lastActualLineCount) : undefined,
  };
}

function weekLabelsFromTemplate(template) {
  const labels = new Set();
  for (const section of template?.sections || []) {
    for (const week of section.weekColumns || []) {
      if (week?.raw) labels.add(readOptionalText(week.raw));
    }
  }
  return labels;
}

function assertConfiguredWeekRangeExistsInTemplate(template, { startWeek, endWeek }) {
  const labels = weekLabelsFromTemplate(template);
  const missing = [readOptionalText(startWeek), readOptionalText(endWeek)]
    .filter(Boolean)
    .filter((label) => !labels.has(label));
  if (missing.length === 0) return;
  throw createHttpError(
    400,
    `시작/종료 주차가 시트 헤더에 없습니다: ${missing.join(', ')}`,
    'cashflow_week_range_not_in_sheet',
  );
}

function resolveSystemAccountEmail(googleSheetsService) {
  if (typeof googleSheetsService?.getServiceAccountEmail === 'function') {
    return readOptionalText(googleSheetsService.getServiceAccountEmail());
  }
  return readOptionalText(googleSheetsService?.serviceAccountEmail);
}

function buildConfigResponse(projectId, config, systemAccountEmail = '') {
  const serviceAccountEmail = readOptionalText(systemAccountEmail);
  return {
    projectId,
    configured: Boolean(config),
    config,
    ...(serviceAccountEmail ? {
      systemAccountEmail: serviceAccountEmail,
      accessPolicy: {
        googleAuth: 'service_account',
        serviceAccountEmail,
        sheetPermission: 'shared_with_mysc_system_account',
      },
    } : {}),
  };
}

async function hydrateCashflowSheetLabConfigTitle(config, googleSheetsService) {
  if (!config || readOptionalText(config.spreadsheetTitle)) return config;
  const spreadsheetId = readOptionalText(config.spreadsheetId) || extractSpreadsheetId(config.value);
  if (!spreadsheetId || typeof googleSheetsService?.getSpreadsheetMeta !== 'function') return config;
  try {
    const meta = await googleSheetsService.getSpreadsheetMeta(spreadsheetId);
    const spreadsheetTitle = readOptionalText(meta?.spreadsheetTitle);
    return spreadsheetTitle ? { ...config, spreadsheetTitle } : config;
  } catch {
    return config;
  }
}

function resolvePreviewSource(parsed, savedConfig) {
  const value = readOptionalText(parsed.value);
  if (value) {
    return {
      value,
      sheetName: readOptionalText(parsed.sheetName) || undefined,
      startWeek: readOptionalText(parsed.startWeek),
      endWeek: readOptionalText(parsed.endWeek),
      source: 'request',
    };
  }
  if (savedConfig?.value) {
    return {
      value: savedConfig.value,
      sheetName: readOptionalText(parsed.sheetName) || savedConfig.sheetName || undefined,
      startWeek: readOptionalText(parsed.startWeek) || savedConfig.startWeek,
      endWeek: readOptionalText(parsed.endWeek) || savedConfig.endWeek,
      source: 'saved_config',
    };
  }
  throw createHttpError(
    400,
    'Cashflow sheet URL is not configured. Save the sheet link first.',
    'cashflow_sheet_config_required',
  );
}

function weekSortKey(week) {
  if (!week) return null;
  return week.year * 10000 + week.month * 100 + week.weekNo;
}

function normalizeWeekRange({ startWeek, endWeek }) {
  const start = readOptionalText(startWeek);
  const end = readOptionalText(endWeek);
  const parsedStart = start ? parseCashflowWeekLabel(start) : null;
  const parsedEnd = end ? parseCashflowWeekLabel(end) : null;
  if (start && !parsedStart) {
    throw createHttpError(400, `Invalid startWeek: ${start}`, 'cashflow_week_range_invalid');
  }
  if (end && !parsedEnd) {
    throw createHttpError(400, `Invalid endWeek: ${end}`, 'cashflow_week_range_invalid');
  }
  if (parsedStart && parsedEnd && weekSortKey(parsedStart) > weekSortKey(parsedEnd)) {
    throw createHttpError(400, 'startWeek must be before or equal to endWeek.', 'cashflow_week_range_invalid');
  }
  return {
    startWeek: parsedStart?.raw || '',
    endWeek: parsedEnd?.raw || '',
    startKey: weekSortKey(parsedStart),
    endKey: weekSortKey(parsedEnd),
  };
}

function isInWeekRange(value, range) {
  if (!range?.startKey && !range?.endKey) return true;
  const key = weekSortKey({
    year: Number.parseInt(String(value.yearMonth).slice(0, 4), 10),
    month: Number.parseInt(String(value.yearMonth).slice(5, 7), 10),
    weekNo: Number(value.weekNo),
  });
  if (!Number.isFinite(key)) return false;
  if (range.startKey && key < range.startKey) return false;
  if (range.endKey && key > range.endKey) return false;
  return true;
}

function buildActiveWeeksFromTemplate(template, weekRange) {
  const projectionSection = template.sections?.find((section) => section.mode === 'projection');
  const sourceWeeks = projectionSection?.weekColumns || template.sections?.[0]?.weekColumns || [];
  const seen = new Set();
  return sourceWeeks
    .filter((week) => isInWeekRange(week, weekRange))
    .map((week) => {
      const key = `${week.yearMonth}:${week.weekNo}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        label: week.raw,
        year: week.year,
        month: week.month,
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        source: 'sheet_header',
      };
    })
    .filter(Boolean);
}

function resolveGoogleSheetAuthMode() {
  return 'service_account';
}

function resolveGoogleSheetPermission() {
  return 'shared_with_mysc_system_account';
}

async function saveCashflowSheetLabConfig({ db, tenantId, projectId, parsed, context, existingConfig = null }) {
  if (!db) {
    throw createHttpError(503, 'Firestore is required to save cashflow sheet config.', 'firestore_unconfigured');
  }
  const now = new Date().toISOString();
  const spreadsheetId = extractSpreadsheetId(parsed.value);
  const existingSpreadsheetId = readOptionalText(existingConfig?.spreadsheetId);
  const shouldKeepVerifiedMetadata = Boolean(existingConfig)
    && existingSpreadsheetId
    && existingSpreadsheetId === spreadsheetId
    && readOptionalText(existingConfig?.sheetName) === readOptionalText(parsed.sheetName);
  const config = {
    value: parsed.value,
    sheetName: readOptionalText(parsed.sheetName),
    spreadsheetId,
    spreadsheetTitle: shouldKeepVerifiedMetadata ? readOptionalText(existingConfig?.spreadsheetTitle) : '',
    startWeek: readOptionalText(parsed.startWeek),
    endWeek: readOptionalText(parsed.endWeek),
    weekBasis: CASHFLOW_WEEK_BASIS,
    totalBasis: CASHFLOW_WEEK_BASIS,
    updatedAt: now,
    updatedBy: {
      uid: readOptionalText(context?.actorId),
      email: readOptionalText(context?.actorEmail),
      role: 'workspace_user',
    },
  };
  await db.doc(projectDocPath(tenantId, projectId)).set(stripUndefinedDeep({
    cashflowSheetLab: config,
    updatedAt: now,
  }), { merge: true });
  return config;
}

async function saveCashflowSheetLabActiveWeeks({ db, tenantId, projectId, activeWeeks, now }) {
  if (!db) return;
  await db.doc(projectDocPath(tenantId, projectId)).set(stripUndefinedDeep({
    cashflowSheetLab: {
      activeWeeks,
      weekBasis: CASHFLOW_WEEK_BASIS,
      totalBasis: CASHFLOW_WEEK_BASIS,
    },
    updatedAt: now,
  }), { merge: true });
}

async function saveCashflowSheetLabApplyMetadata({ db, tenantId, projectId, context, now, result }) {
  if (!db) return;
  await db.doc(projectDocPath(tenantId, projectId)).set(stripUndefinedDeep({
    cashflowSheetLab: {
      lastAppliedAt: now,
      lastAppliedBy: {
        uid: readOptionalText(context?.actorId),
        email: readOptionalText(context?.actorEmail),
        role: readOptionalText(context?.actorRole) || 'workspace_user',
      },
      lastAppliedLineCount: result.appliedLineCount,
      lastProjectionLineCount: result.projectionLineCount,
      lastActualLineCount: result.actualLineCount,
    },
    updatedAt: now,
  }), { merge: true });
}

async function saveCashflowEvents({ db, tenantId, events }) {
  if (!db || events.length === 0) return;
  for (let offset = 0; offset < events.length; offset += 450) {
    await Promise.all(events.slice(offset, offset + 450).map((event) => {
      const id = `evt_${stableHash(event).slice(0, 32)}`;
      return db.doc(`orgs/${tenantId}/${CASHFLOW_EVENTS_COLLECTION_ID}/${id}`).set(stripUndefinedDeep({ ...event, id }));
    }));
  }
}

async function saveCashflowChangeCandidates({ db, tenantId, candidates }) {
  if (!db || candidates.length === 0) return;
  for (let offset = 0; offset < candidates.length; offset += 450) {
    await Promise.all(candidates.slice(offset, offset + 450).map((candidate) => {
      const id = `cfc_${stableHash(candidate).slice(0, 32)}`;
      return db.doc(`orgs/${tenantId}/${CASHFLOW_CHANGE_CANDIDATES_COLLECTION_ID}/${id}`).set(stripUndefinedDeep({ ...candidate, id }));
    }));
  }
}

async function readCashflowChangeCandidatesByRun({ db, tenantId, projectId, runId }) {
  if (!db) return [];
  const snap = await db.collection(`orgs/${tenantId}/${CASHFLOW_CHANGE_CANDIDATES_COLLECTION_ID}`).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((candidate) => (
      readOptionalText(candidate.projectId) === readOptionalText(projectId)
      && readOptionalText(candidate.runId) === readOptionalText(runId)
      && readOptionalText(candidate.status || 'pending_review') === 'pending_review'
    ));
}

async function markCashflowChangeCandidatesStatus({ db, tenantId, candidates, status, now }) {
  if (!db || candidates.length === 0) return;
  for (let offset = 0; offset < candidates.length; offset += 450) {
    await Promise.all(candidates.slice(offset, offset + 450).map((candidate) => db
      .doc(`orgs/${tenantId}/${CASHFLOW_CHANGE_CANDIDATES_COLLECTION_ID}/${candidate.id}`)
      .set(stripUndefinedDeep({
        status,
        updatedAt: now,
        appliedAt: status === 'applied' ? now : undefined,
      }), { merge: true })));
  }
}

async function readCashflowWeeksSnapshot(db, tenantId, projectId) {
  const snap = await db.collection(`orgs/${tenantId}/${CASHFLOW_WEEKS_COLLECTION_ID}`)
    .where('projectId', '==', projectId)
    .get();
  return {
    weeks: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
}

function resolveCashflowWeekDocId(projectId, yearMonth, weekNo) {
  return `${readOptionalText(projectId)}-${readOptionalText(yearMonth)}-w${Math.trunc(Number(weekNo))}`;
}

async function readCashflowWeeksSnapshotByKeys(db, tenantId, projectId, weekKeys = []) {
  const normalizedKeys = [...new Set((weekKeys || [])
    .map((week) => ({
      yearMonth: readOptionalText(week?.yearMonth),
      weekNo: Math.trunc(Number(week?.weekNo)),
    }))
    .filter((week) => week.yearMonth && Number.isFinite(week.weekNo))
    .map((week) => resolveCashflowWeekDocId(projectId, week.yearMonth, week.weekNo)))];

  const docs = await Promise.all(normalizedKeys.map(async (id) => {
    const snap = await db.doc(`orgs/${tenantId}/${CASHFLOW_WEEKS_COLLECTION_ID}/${id}`).get();
    return snap.exists ? { id, ...snap.data() } : null;
  }));
  return {
    weeks: docs.filter(Boolean),
  };
}

function setFiniteAmount(index, mapping, amount) {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    index.set(cashflowMappingKey(mapping), amount);
  }
}

function buildSnapshotAmountIndex(snapshot) {
  const index = new Map();
  const weeks = Array.isArray(snapshot?.weeks) ? snapshot.weeks : [];
  for (const week of weeks) {
    const yearMonth = readOptionalText(week?.yearMonth);
    const weekNo = Number(week?.weekNo);
    if (!yearMonth || !Number.isFinite(weekNo)) continue;
    for (const mode of ['projection', 'actual']) {
      const amounts = week?.[mode] && typeof week[mode] === 'object' ? week[mode] : {};
      for (const [lineId, amount] of Object.entries(amounts)) {
        setFiniteAmount(index, { mode, yearMonth, weekNo, lineId }, amount);
      }
    }
  }

  return index;
}

function readIndexedSnapshotAmount(index, mapping) {
  if (!index) return null;
  const amount = index.get(cashflowMappingKey(mapping));
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
}

function hasIndexedSnapshotAmount(index, mapping) {
  return Boolean(index?.has(cashflowMappingKey(mapping)));
}

function readSheetCell(matrix, mapping) {
  return readOptionalText(matrix?.[mapping.rowIndex]?.[mapping.columnIndex]);
}

function parseCashflowSheetAmount(value) {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text || /^[-–—―]+$/.test(text)) return 0;
  const normalizedMinus = text.replace(/[−﹣－]/g, '-');
  const parenthesizedNegative = /^\(.*\)$/.test(normalizedMinus);
  let cleaned = normalizedMinus
    .replace(/[,\s\u00a0원₩￦]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^0-9.+-]/g, '');
  if (!cleaned) return 0;
  if (cleaned.endsWith('-') && cleaned.length > 1) {
    cleaned = `-${cleaned.slice(0, -1)}`;
  }
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return parenthesizedNegative && parsed > 0 ? -parsed : parsed;
}

function buildPreviewValues(template, cashflowSnapshot, matrix = []) {
  const amountIndex = cashflowSnapshot ? buildSnapshotAmountIndex(cashflowSnapshot) : null;
  return template.mappingCandidates.map((mapping) => ({
    ...mapping,
    sheetValue: readSheetCell(matrix, mapping),
    amount: readIndexedSnapshotAmount(amountIndex, mapping),
    source: 'firebase_cashflow_weeks',
  }));
}

function buildApplyPlan(template, matrix = [], weekRange) {
  const lines = [];
  for (const mapping of template.mappingCandidates) {
    if (!isInWeekRange(mapping, weekRange)) continue;
    lines.push({
      mode: mapping.mode,
      yearMonth: mapping.yearMonth,
      weekNo: mapping.weekNo,
      cashflowLine: mapping.lineId,
      direction: mapping.direction,
      amount: parseCashflowSheetAmount(readSheetCell(matrix, mapping)),
      sourceCell: mapping.a1,
      sourceLabel: mapping.label || mapping.canonicalLabel || mapping.lineId,
    });
  }
  return {
    lines,
    skippedInvalidWeekKeys: [],
  };
}

function groupApplyLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.mode}:${line.yearMonth}:${line.weekNo}`;
    const group = groups.get(key) || {
      mode: line.mode,
      yearMonth: line.yearMonth,
      weekNo: line.weekNo,
      amounts: {},
    };
    group.amounts[line.cashflowLine] = line.amount;
    groups.set(key, group);
  }
  return [...groups.values()];
}

function candidateToApplyLine(candidate) {
  return {
    mode: candidate.mode,
    yearMonth: candidate.yearMonth,
    weekNo: candidate.weekNo,
    cashflowLine: candidate.lineId,
    direction: candidate.lineDirection === 'in' ? 'IN' : 'OUT',
    amount: normalizeAppliedAmount(candidate.proposedAmount),
    sourceCell: candidate.sourceCell,
    sourceLabel: candidate.sourceLabel || candidate.lineId,
  };
}

function buildSheetChangeCandidates({ tenantId, projectId, runId, lines, cashflowSnapshot, context, now }) {
  const amountIndex = buildSnapshotAmountIndex(cashflowSnapshot);
  const weekIndex = new Map((cashflowSnapshot?.weeks || []).map((week) => [`${week.yearMonth}:${week.weekNo}`, week]));
  return lines
    .filter((line) => Number.isFinite(Number(line.amount)))
    .map((line) => {
      const mapping = {
        mode: line.mode,
        yearMonth: line.yearMonth,
        weekNo: line.weekNo,
        lineId: line.cashflowLine,
      };
      const beforeHadValue = hasIndexedSnapshotAmount(amountIndex, mapping);
      const beforeAmount = beforeHadValue ? normalizeAppliedAmount(readIndexedSnapshotAmount(amountIndex, mapping)) : null;
      const proposedAmount = normalizeAppliedAmount(line.amount);
      const week = weekIndex.get(`${line.yearMonth}:${line.weekNo}`);
      const riskFlags = [];
      if (week?.adminClosed) riskFlags.push('closed_week_change');
      if (beforeHadValue && beforeAmount === proposedAmount) return null;
      return {
        tenantId,
        projectId,
        runId,
        source: 'google_sheet',
        status: 'pending_review',
        mode: line.mode,
        yearMonth: line.yearMonth,
        weekNo: line.weekNo,
        lineId: line.cashflowLine,
        lineDirection: line.direction === 'IN' ? 'in' : 'out',
        beforeAmount,
        beforeHadValue,
        proposedAmount,
        proposedHadValue: true,
        sourceCell: line.sourceCell,
        sourceLabel: line.sourceLabel,
        riskFlags,
        actorUid: readOptionalText(context?.actorId),
        actorName: readOptionalText(context?.actorEmail) || readOptionalText(context?.actorId),
        actorEmail: readOptionalText(context?.actorEmail),
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter(Boolean);
}

function appliedLineKey(line) {
  return `${line.mode}:${line.yearMonth}:${line.weekNo}:${line.cashflowLine}`;
}

function normalizeAppliedAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildProjectionSheetBaselineCells(cells) {
  return cells
    .map((cell) => ({
      key: `${cell.yearMonth}:${cell.weekNo}:${cell.lineId}`,
      a1: cell.a1,
      sheetAmount: normalizeAppliedAmount(cell.sheetAmount),
    }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.a1.localeCompare(b.a1));
}

function buildProjectionWritebackPlan(template, matrix = [], cashflowSnapshot, weekRange) {
  const amountIndex = buildSnapshotAmountIndex(cashflowSnapshot);
  const projectionMappings = template.mappingCandidates
    .filter((mapping) => mapping.mode === 'projection')
    .filter((mapping) => isInWeekRange(mapping, weekRange));

  const cells = projectionMappings.map((mapping) => {
    const platformAmount = readIndexedSnapshotAmount(amountIndex, mapping) ?? 0;
    const sheetValue = readSheetCell(matrix, mapping);
    const sheetAmount = parseCashflowSheetAmount(sheetValue);
    const nextSheetValue = normalizeAppliedAmount(platformAmount);
    return {
      mode: 'projection',
      lineId: mapping.lineId,
      label: mapping.label || mapping.canonicalLabel || mapping.lineId,
      canonicalLabel: mapping.canonicalLabel,
      direction: mapping.direction,
      yearMonth: mapping.yearMonth,
      weekNo: mapping.weekNo,
      rowIndex: mapping.rowIndex,
      columnIndex: mapping.columnIndex,
      a1: mapping.a1,
      sheetValue,
      sheetAmount,
      platformAmount: nextSheetValue,
      nextSheetValue,
      changed: normalizeAppliedAmount(sheetAmount) !== nextSheetValue,
    };
  });
  const baselineCells = buildProjectionSheetBaselineCells(cells);
  const changes = cells.filter((cell) => cell.changed);
  const changedAmountTotal = changes.reduce((sum, cell) => sum + Math.abs(cell.platformAmount - cell.sheetAmount), 0);

  return {
    mode: 'projection',
    baselineHash: stableHash(baselineCells),
    totalCellCount: cells.length,
    changeCount: changes.length,
    changedAmountTotal,
    hasChanges: changes.length > 0,
    changedCells: changes.slice(0, 200),
    omittedChangedCellCount: Math.max(0, changes.length - 200),
    baseline: {
      cellCount: baselineCells.length,
      hashAlgorithm: 'sha256',
    },
    updates: changes.map((cell) => ({
      rangeA1: cell.a1,
      value: cell.nextSheetValue,
      values: [[cell.nextSheetValue]],
    })),
  };
}

function buildProjectionWritebackResponse({
  projectId,
  preview,
  template,
  weekRange,
  plan,
  authMode,
  cashflowSnapshotStatus = 'ready',
  job = null,
  durationMs,
}) {
  const googleAuth = readOptionalText(authMode || preview?.authMode) || 'service_account';
  return {
    projectId,
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
    spreadsheetId: preview.spreadsheetId,
    spreadsheetTitle: preview.spreadsheetTitle,
    selectedSheetName: preview.selectedSheetName,
    activeWeekRange: {
      startWeek: weekRange.startWeek,
      endWeek: weekRange.endWeek,
      weekBasis: CASHFLOW_WEEK_BASIS,
      totalBasis: CASHFLOW_WEEK_BASIS,
      activeWeeks: buildActiveWeeksFromTemplate(template, weekRange),
    },
    accessPolicy: {
      googleAuth,
      googleScope: 'spreadsheets',
      sheetPermission: resolveGoogleSheetPermission(googleAuth),
      writePolicy: 'projection_only',
      conflictPolicy: 'baseline_hash_required_before_write',
      sheetNamePolicy: 'cashflow_usage_linked_only',
      valueSource: 'firebase_cashflow_weeks.projection',
    },
    template: {
      supported: template.supported,
      mappingCount: template.stats?.mappingCount || 0,
      projectionMappingCount: template.mappingCandidates.filter((mapping) => mapping.mode === 'projection').length,
      reasons: template.reasons || [],
    },
    plan: {
      baselineHash: plan.baselineHash,
      totalCellCount: plan.totalCellCount,
      changeCount: plan.changeCount,
      changedAmountTotal: plan.changedAmountTotal,
      hasChanges: plan.hasChanges,
      changedCells: plan.changedCells,
      omittedChangedCellCount: plan.omittedChangedCellCount,
      baseline: plan.baseline,
    },
    cashflowSnapshotStatus,
    job,
  };
}

function buildProjectionSyncJobId(projectId) {
  return `cfsync_${readOptionalText(projectId).replace(/[^A-Za-z0-9_-]/g, '_')}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

async function writeProjectionSyncJob({ db, tenantId, projectId, requestId, context, status, payload }) {
  if (!db) return null;
  const now = new Date().toISOString();
  const jobId = payload?.id || buildProjectionSyncJobId(projectId);
  const job = stripUndefinedDeep({
    id: jobId,
    tenantId,
    projectId,
    requestId,
    type: 'projection_google_sheet_writeback',
    status,
    createdAt: payload?.createdAt || now,
    updatedAt: now,
    actor: {
      uid: readOptionalText(context?.actorId),
      email: readOptionalText(context?.actorEmail),
      role: readOptionalText(context?.actorRole),
    },
    ...payload,
  });
  await db.doc(`orgs/${tenantId}/${CASHFLOW_PROJECTION_SYNC_JOBS_COLLECTION_ID}/${jobId}`).set(job, { merge: true });
  await db.doc(`outbox/${jobId}`).set(stripUndefinedDeep({
    id: jobId,
    tenantId,
    requestId,
    eventType: `cashflow.projection_sheet_writeback.${String(status || '').toLowerCase()}`,
    entityType: 'cashflow_projection_sync_job',
    entityId: jobId,
    payload: {
      projectId,
      status,
      changeCount: payload?.changeCount,
      baselineHash: payload?.baselineHash,
      spreadsheetId: payload?.spreadsheetId,
      selectedSheetName: payload?.selectedSheetName,
    },
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  }), { merge: true });
  return job;
}

function verifyPostApplyReadback(lines, previewValues) {
  const actualByKey = new Map();
  for (const value of previewValues || []) {
    actualByKey.set(appliedLineKey({
      mode: value.mode,
      yearMonth: value.yearMonth,
      weekNo: value.weekNo,
      cashflowLine: value.lineId,
    }), value.amount);
  }

  const mismatches = [];
  for (const line of lines) {
    const expected = normalizeAppliedAmount(line.amount);
    const actual = actualByKey.get(appliedLineKey(line));
    if (actual !== expected) {
      mismatches.push({
        mode: line.mode,
        yearMonth: line.yearMonth,
        weekNo: line.weekNo,
        cashflowLine: line.cashflowLine,
        expected,
        actual: actual ?? null,
      });
    }
  }

  if (mismatches.length > 0) {
    const error = createHttpError(
      500,
      `Cashflow sheet apply verification failed for ${mismatches.length} cells.`,
      'cashflow_sheet_apply_verify_failed',
    );
    error.details = { mismatches: mismatches.slice(0, 20) };
    throw error;
  }

  return { verifiedLineCount: lines.length };
}

function verifyPostApplySnapshot(lines, cashflowSnapshot) {
  const amountIndex = buildSnapshotAmountIndex(cashflowSnapshot);
  const mismatches = [];
  for (const line of lines) {
    const expected = normalizeAppliedAmount(line.amount);
    const actual = readIndexedSnapshotAmount(amountIndex, {
      mode: line.mode,
      yearMonth: line.yearMonth,
      weekNo: line.weekNo,
      lineId: line.cashflowLine,
    });
    if (actual !== expected) {
      mismatches.push({
        mode: line.mode,
        yearMonth: line.yearMonth,
        weekNo: line.weekNo,
        cashflowLine: line.cashflowLine,
        expected,
        actual: actual ?? null,
      });
    }
  }

  if (mismatches.length > 0) {
    const error = createHttpError(
      500,
      `Cashflow staged apply verification failed for ${mismatches.length} cells.`,
      'cashflow_sheet_stage_apply_verify_failed',
    );
    error.details = { mismatches: mismatches.slice(0, 20) };
    throw error;
  }

  return { verifiedLineCount: lines.length };
}

async function applyStagedCashflowSheetLab({
  db,
  tenantId,
  projectId,
  parsed = {},
  context = {},
  javaWeeklyClient = null,
  editSession = null,
  idempotencyKey = '',
  logger = () => {},
} = {}) {
  const stagedRunId = readOptionalText(parsed.stageRunId);
  const now = new Date().toISOString();
  logger('staged.start', {
    projectId,
    stagedRunId,
    applyRiskCandidates: Boolean(parsed.applyRiskCandidates),
  });
  if (!stagedRunId) {
    throw createHttpError(400, '검토 후보 runId가 필요합니다.', 'cashflow_sheet_stage_run_required');
  }

  const candidates = await readCashflowChangeCandidatesByRun({ db, tenantId, projectId, runId: stagedRunId });
  if (candidates.length === 0) {
    throw createHttpError(400, '저장할 검토 후보가 없습니다.', 'cashflow_sheet_stage_candidates_empty');
  }

  const riskCandidates = candidates.filter((candidate) => Array.isArray(candidate.riskFlags) && candidate.riskFlags.length > 0);
  const selectedCandidates = parsed.applyRiskCandidates
    ? candidates
    : candidates.filter((candidate) => !Array.isArray(candidate.riskFlags) || candidate.riskFlags.length === 0);
  if (selectedCandidates.length === 0) {
    throw createHttpError(
      409,
      '확인 필요 후보만 있습니다. 전체 검토 후 저장해 주세요.',
      'cashflow_sheet_stage_only_risk_candidates',
    );
  }

  const lines = selectedCandidates.map(candidateToApplyLine);
  if (javaWeeklyClient) {
    const javaResult = await javaWeeklyClient.applyCashflowSheetLab({
      context,
      projectId,
      idempotencyKey,
      editSession,
      lines: lines.map(({ mode, yearMonth, weekNo, cashflowLine, amount, sourceCell, sourceLabel }) => ({
        mode,
        yearMonth,
        weekNo,
        cashflowLine,
        amount,
        sourceCell,
        sourceLabel,
      })),
    });
    await markCashflowChangeCandidatesStatus({
      db,
      tenantId,
      candidates: selectedCandidates,
      status: 'applied',
      now,
    });
    const projectionLineCount = Number(javaResult.savedProjectionLineCount)
      || lines.filter((line) => line.mode === 'projection').length;
    const actualLineCount = Number(javaResult.savedActualLineCount)
      || lines.filter((line) => line.mode === 'actual').length;
    return {
      ok: true,
      commandName: readOptionalText(javaResult.commandName) || 'weeklyExpense.cashflowSheetLab.apply',
      projectId,
      sourceSheetKey: 'cashflow-sheet-lab',
      weekBasis: CASHFLOW_WEEK_BASIS,
      totalBasis: CASHFLOW_WEEK_BASIS,
      appliedLineCount: lines.length,
      projectionLineCount,
      actualLineCount,
      skippedRiskLineCount: riskCandidates.length,
      lastAppliedAt: now,
      runId: `cashflow-sheet-apply:${projectId}:${now}`,
      stagedRunId,
      lastAppliedBy: {
        uid: readOptionalText(context?.actorId),
        email: readOptionalText(context?.actorEmail),
        role: readOptionalText(context?.actorRole) || 'workspace_user',
      },
      firebaseResult: {
        ...javaResult,
        commandName: readOptionalText(javaResult.commandName) || 'weeklyExpense.cashflowSheetLab.apply',
        verifiedLineCount: lines.length,
      },
    };
  }
  const groups = groupApplyLines(lines);
  const updatedWeeks = [];
  const runId = `cashflow-sheet-apply:${projectId}:${now}`;
  for (const group of groups) {
    updatedWeeks.push(await upsertCashflowWeekAmounts({
      db,
      tenantId,
      actorId: readOptionalText(context?.actorId),
      actorName: readOptionalText(context?.actorEmail) || readOptionalText(context?.actorId),
      projectId,
      mode: group.mode,
      yearMonth: group.yearMonth,
      weekNo: group.weekNo,
      amounts: group.amounts,
      now,
      allowSheetWeek: true,
    }));
  }

  const actorUid = readOptionalText(context?.actorId);
  const actorEmail = readOptionalText(context?.actorEmail);
  const actorName = actorEmail || actorUid;
  const projectionLineCount = lines.filter((line) => line.mode === 'projection').length;
  const actualLineCount = lines.filter((line) => line.mode === 'actual').length;
  await saveCashflowEvents({
    db,
    tenantId,
    events: [
      {
        tenantId,
        projectId,
        runId,
        stagedRunId,
        type: 'sheet_apply',
        source: 'google_sheet_apply',
        appliedLineCount: lines.length,
        projectionLineCount,
        actualLineCount,
        skippedRiskLineCount: riskCandidates.length,
        actorUid,
        actorName,
        actorEmail,
        createdAt: now,
      },
      ...updatedWeeks.flatMap((week) => (week.amountChanges || []).map((change) => ({
        tenantId,
        projectId,
        runId,
        stagedRunId,
        type: change.mode === 'projection' ? 'projection_amount_change' : 'actual_amount_change',
        source: 'google_sheet_apply',
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        mode: change.mode,
        lineId: change.lineId,
        beforeAmount: change.beforeAmount,
        afterAmount: change.afterAmount,
        beforeHadValue: change.beforeHadValue,
        afterHadValue: change.afterHadValue,
        actorUid,
        actorName,
        actorEmail,
        createdAt: now,
      }))),
    ],
  });

  const postApplySnapshot = await readCashflowWeeksSnapshotByKeys(db, tenantId, projectId, updatedWeeks);
  const verification = verifyPostApplySnapshot(lines, postApplySnapshot);
  await saveCashflowSheetLabApplyMetadata({
    db,
    tenantId,
    projectId,
    context,
    now,
    result: {
      appliedLineCount: lines.length,
      projectionLineCount,
      actualLineCount,
    },
  });
  await markCashflowChangeCandidatesStatus({
    db,
    tenantId,
    candidates: selectedCandidates,
    status: 'applied',
    now,
  });

  logger('staged.ok', {
    projectId,
    stagedRunId,
    appliedLineCount: lines.length,
    riskLineCount: riskCandidates.length,
    verifiedLineCount: verification.verifiedLineCount,
  });

  return {
    ok: true,
    commandName: 'cashflowSheetLab.apply.firebase',
    projectId,
    sourceSheetKey: 'cashflow-sheet-lab',
    weekBasis: CASHFLOW_WEEK_BASIS,
    totalBasis: CASHFLOW_WEEK_BASIS,
    appliedLineCount: lines.length,
    projectionLineCount,
    actualLineCount,
    skippedRiskLineCount: riskCandidates.length,
    lastAppliedAt: now,
    runId,
    stagedRunId,
    lastAppliedBy: {
      uid: actorUid,
      email: actorEmail,
      role: readOptionalText(context?.actorRole) || 'workspace_user',
    },
    firebaseResult: {
      ok: true,
      commandName: 'cashflowSheetLab.apply.firebase',
      projectId,
      sourceSheetKey: 'cashflow-sheet-lab',
      weekBasis: CASHFLOW_WEEK_BASIS,
      totalBasis: CASHFLOW_WEEK_BASIS,
      savedProjectionLineCount: projectionLineCount,
      savedActualLineCount: actualLineCount,
      verifiedLineCount: verification.verifiedLineCount,
      updatedWeeks,
    },
  };
}

async function applyConfiguredCashflowSheetLab({
  db,
  tenantId,
  projectId,
  project,
  parsed = {},
  loadSheetPreview,
  context = {},
  javaWeeklyClient = null,
  editSession = null,
  idempotencyKey = '',
  logger = () => {},
} = {}) {
  const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
  const weekRange = normalizeWeekRange(source);
  logger('start', {
    projectId,
    authMode: 'service_account',
    source: source.source,
    sheetName: source.sheetName || null,
    valueProvided: Boolean(source.value),
    startWeek: weekRange.startWeek || null,
    endWeek: weekRange.endWeek || null,
  });

  const preview = await loadSheetPreview({
    value: source.value,
    sheetName: source.sheetName,
  });
  const authMode = resolveGoogleSheetAuthMode(preview);
  assertCashflowUsageLinkedSheet(preview);
  const template = analyzeCashflowSheetTemplate(preview.matrix);
  assertConfiguredWeekRangeExistsInTemplate(template, weekRange);
  logger('template', {
    projectId,
    authMode,
    spreadsheetId: preview.spreadsheetId,
    selectedSheetName: preview.selectedSheetName,
    cacheStatus: preview.cacheStatus,
    templateSupported: template.supported,
    mappingCount: template.stats?.mappingCount || 0,
    ignoredRowCount: template.ignoredRows?.length || 0,
    reasonCount: template.reasons?.length || 0,
  });
  if (!template.supported) {
    throw createHttpError(
      400,
      '지원하지 않는 cashflow 시트 구조라 반영할 수 없습니다.',
      'cashflow_sheet_template_unsupported',
    );
  }
  const applyPlan = buildApplyPlan(template, preview.matrix, weekRange);
  const activeWeeks = buildActiveWeeksFromTemplate(template, weekRange);
  const { lines, skippedInvalidWeekKeys } = applyPlan;
  logger('lines', {
    projectId,
    authMode,
    applyLineCount: lines.length,
    projectionLineCount: lines.filter((line) => line.mode === 'projection').length,
    actualLineCount: lines.filter((line) => line.mode === 'actual').length,
    skippedInvalidWeekCount: skippedInvalidWeekKeys.length,
    skippedInvalidWeeks: skippedInvalidWeekKeys,
  });
  if (lines.length === 0) {
    throw createHttpError(400, '반영할 cashflow 값이 없습니다.', 'cashflow_sheet_apply_empty');
  }
  if (javaWeeklyClient) {
    const javaResult = await javaWeeklyClient.applyCashflowSheetLab({
      context,
      projectId,
      idempotencyKey,
      editSession,
      lines: lines.map(({ mode, yearMonth, weekNo, cashflowLine, amount, sourceCell, sourceLabel }) => ({
        mode,
        yearMonth,
        weekNo,
        cashflowLine,
        amount,
        sourceCell,
        sourceLabel,
      })),
    });
    const now = new Date().toISOString();
    const projectionLineCount = Number(javaResult.savedProjectionLineCount)
      || lines.filter((line) => line.mode === 'projection').length;
    const actualLineCount = Number(javaResult.savedActualLineCount)
      || lines.filter((line) => line.mode === 'actual').length;
    return {
      projectId,
      spreadsheetId: preview.spreadsheetId,
      spreadsheetTitle: preview.spreadsheetTitle,
      selectedSheetName: preview.selectedSheetName,
      availableSheets: preview.availableSheets,
      activeWeekRange: {
        startWeek: weekRange.startWeek,
        endWeek: weekRange.endWeek,
        weekBasis: CASHFLOW_WEEK_BASIS,
        totalBasis: CASHFLOW_WEEK_BASIS,
        activeWeeks,
      },
      matrix: preview.matrix,
      accessPolicy: {
        googleAuth: authMode,
        googleScope: 'spreadsheets.readonly',
        sheetPermission: resolveGoogleSheetPermission(authMode),
        layoutSource: 'google_sheet_formatted_values',
        valueSource: 'jvm_cashflow_transaction',
        sheetReadRange: CASHFLOW_SHEET_LAB_READ_RANGE,
        sheetNamePolicy: 'cashflow_usage_linked_only',
        weekBasis: CASHFLOW_WEEK_BASIS,
        totalBasis: CASHFLOW_WEEK_BASIS,
      },
      template,
      previewValues: buildPreviewValues(template, javaCashflowSnapshot(javaResult), preview.matrix)
        .filter((value) => isInWeekRange(value, weekRange)),
      cashflowSnapshotStatus: 'ready',
      cashflowSnapshotError: null,
      appliedLineCount: lines.length,
      projectionLineCount,
      actualLineCount,
      lastAppliedAt: now,
      runId: `cashflow-sheet-apply:${projectId}:${now}`,
      lastAppliedBy: {
        uid: readOptionalText(context?.actorId),
        email: readOptionalText(context?.actorEmail),
        role: readOptionalText(context?.actorRole) || 'workspace_user',
      },
      skippedInvalidWeekCount: skippedInvalidWeekKeys.length,
      skippedInvalidWeeks: skippedInvalidWeekKeys,
      verifiedLineCount: lines.length,
      firebaseResult: {
        ...javaResult,
        commandName: readOptionalText(javaResult.commandName) || 'weeklyExpense.cashflowSheetLab.apply',
        verifiedLineCount: lines.length,
      },
    };
  }
  const groups = groupApplyLines(lines);
  const updatedWeeks = [];
  const now = new Date().toISOString();
  const runId = `cashflow-sheet-apply:${projectId}:${now}`;
  await saveCashflowSheetLabActiveWeeks({ db, tenantId, projectId, activeWeeks, now });
  for (const group of groups) {
    updatedWeeks.push(await upsertCashflowWeekAmounts({
      db,
      tenantId,
      actorId: readOptionalText(context?.actorId),
      actorName: readOptionalText(context?.actorEmail) || readOptionalText(context?.actorId),
      projectId,
      mode: group.mode,
      yearMonth: group.yearMonth,
      weekNo: group.weekNo,
      amounts: group.amounts,
      now,
      allowSheetWeek: true,
    }));
  }
  const actorUid = readOptionalText(context?.actorId);
  const actorEmail = readOptionalText(context?.actorEmail);
  const actorName = actorEmail || actorUid;
  await saveCashflowEvents({
    db,
    tenantId,
    events: [
      {
        tenantId,
        projectId,
        runId,
        type: 'sheet_apply',
        source: 'google_sheet_apply',
        appliedLineCount: lines.length,
        projectionLineCount: lines.filter((line) => line.mode === 'projection').length,
        actualLineCount: lines.filter((line) => line.mode === 'actual').length,
        actorUid,
        actorName,
        actorEmail,
        createdAt: now,
      },
      ...updatedWeeks.flatMap((week) => (week.amountChanges || []).map((change) => ({
        tenantId,
        projectId,
        runId,
        type: change.mode === 'projection' ? 'projection_amount_change' : 'actual_amount_change',
        source: 'google_sheet_apply',
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        mode: change.mode,
        lineId: change.lineId,
        beforeAmount: change.beforeAmount,
        afterAmount: change.afterAmount,
        beforeHadValue: change.beforeHadValue,
        afterHadValue: change.afterHadValue,
        actorUid,
        actorName,
        actorEmail,
        createdAt: now,
      }))),
    ],
  });
  const postApplySnapshot = await readCashflowWeeksSnapshotByKeys(db, tenantId, projectId, updatedWeeks);
  const postApplyPreviewValues = buildPreviewValues(template, postApplySnapshot, preview.matrix)
    .filter((value) => isInWeekRange(value, weekRange));
  const verification = verifyPostApplyReadback(lines, postApplyPreviewValues);
  const projectionLineCount = lines.filter((line) => line.mode === 'projection').length;
  const actualLineCount = lines.filter((line) => line.mode === 'actual').length;
  const applyResult = {
    ok: true,
    commandName: 'cashflowSheetLab.apply.firebase',
    projectId,
    sourceSheetKey: 'cashflow-sheet-lab',
    weekBasis: CASHFLOW_WEEK_BASIS,
    totalBasis: CASHFLOW_WEEK_BASIS,
    savedProjectionLineCount: projectionLineCount,
    savedActualLineCount: actualLineCount,
    skippedInvalidWeekCount: skippedInvalidWeekKeys.length,
    skippedInvalidWeeks: skippedInvalidWeekKeys,
    verifiedLineCount: verification.verifiedLineCount,
    updatedWeeks,
  };
  logger('ok', {
    projectId,
    authMode,
    appliedLineCount: lines.length,
    projectionLineCount,
    actualLineCount,
    postApplyPreviewValueCount: postApplyPreviewValues.length,
    verifiedLineCount: verification.verifiedLineCount,
    updatedWeekCount: updatedWeeks.length,
  });

  await saveCashflowSheetLabApplyMetadata({
    db,
    tenantId,
    projectId,
    context,
    now,
    result: {
      appliedLineCount: lines.length,
      projectionLineCount,
      actualLineCount,
    },
  });

  return {
    projectId,
    spreadsheetId: preview.spreadsheetId,
    spreadsheetTitle: preview.spreadsheetTitle,
    selectedSheetName: preview.selectedSheetName,
    availableSheets: preview.availableSheets,
    activeWeekRange: {
      startWeek: weekRange.startWeek,
      endWeek: weekRange.endWeek,
      weekBasis: CASHFLOW_WEEK_BASIS,
      totalBasis: CASHFLOW_WEEK_BASIS,
      activeWeeks,
    },
    matrix: preview.matrix,
    accessPolicy: {
      googleAuth: authMode,
      googleScope: 'spreadsheets.readonly',
      sheetPermission: resolveGoogleSheetPermission(authMode),
      layoutSource: 'google_sheet_formatted_values',
      valueSource: 'firebase_cashflow_weeks',
      actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read',
      sheetReadRange: CASHFLOW_SHEET_LAB_READ_RANGE,
      sheetPreviewCache: preview.cacheStatus,
      sheetNamePolicy: 'cashflow_usage_linked_only',
      sheetConfigSource: source.source,
      weekBasis: CASHFLOW_WEEK_BASIS,
      totalBasis: CASHFLOW_WEEK_BASIS,
    },
    template,
    previewValues: postApplyPreviewValues,
    cashflowSnapshotStatus: 'ready',
    cashflowSnapshotError: null,
    appliedLineCount: lines.length,
    projectionLineCount,
    actualLineCount,
    lastAppliedAt: now,
    runId,
    lastAppliedBy: {
      uid: readOptionalText(context?.actorId),
      email: readOptionalText(context?.actorEmail),
      role: readOptionalText(context?.actorRole) || 'workspace_user',
    },
    skippedInvalidWeekCount: skippedInvalidWeekKeys.length,
    skippedInvalidWeeks: skippedInvalidWeekKeys,
    verifiedLineCount: verification.verifiedLineCount,
    firebaseResult: applyResult,
  };
}

async function stageConfiguredCashflowSheetLab({
  db,
  tenantId,
  projectId,
  project,
  parsed = {},
  loadSheetPreview,
  context = {},
  logger = () => {},
} = {}) {
  const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
  const weekRange = normalizeWeekRange(source);
  logger('start', {
    projectId,
    authMode: 'service_account',
    source: source.source,
    sheetName: source.sheetName || null,
    valueProvided: Boolean(source.value),
    startWeek: weekRange.startWeek || null,
    endWeek: weekRange.endWeek || null,
  });

  const preview = await loadSheetPreview({
    value: source.value,
    sheetName: source.sheetName,
  });
  const authMode = resolveGoogleSheetAuthMode(preview);
  assertCashflowUsageLinkedSheet(preview);
  const template = analyzeCashflowSheetTemplate(preview.matrix);
  assertConfiguredWeekRangeExistsInTemplate(template, weekRange);
  if (!template.supported) {
    throw createHttpError(
      400,
      '지원하지 않는 cashflow 시트 구조라 검토 후보를 만들 수 없습니다.',
      'cashflow_sheet_template_unsupported',
    );
  }

  const applyPlan = buildApplyPlan(template, preview.matrix, weekRange);
  const activeWeeks = buildActiveWeeksFromTemplate(template, weekRange);
  const { lines, skippedInvalidWeekKeys } = applyPlan;
  if (lines.length === 0) {
    throw createHttpError(400, '검토할 cashflow 값이 없습니다.', 'cashflow_sheet_stage_empty');
  }

  const now = new Date().toISOString();
  const runId = `cashflow-sheet-stage:${projectId}:${now}`;
  const cashflowSnapshot = await readCashflowWeeksSnapshot(db, tenantId, projectId);
  const candidates = buildSheetChangeCandidates({
    tenantId,
    projectId,
    runId,
    lines,
    cashflowSnapshot,
    context,
    now,
  });
  await saveCashflowSheetLabActiveWeeks({ db, tenantId, projectId, activeWeeks, now });
  await saveCashflowChangeCandidates({ db, tenantId, candidates });

  const projectionLineCount = candidates.filter((candidate) => candidate.mode === 'projection').length;
  const actualLineCount = candidates.filter((candidate) => candidate.mode === 'actual').length;
  logger('ok', {
    projectId,
    authMode,
    stagedLineCount: candidates.length,
    projectionLineCount,
    actualLineCount,
    riskCount: candidates.filter((candidate) => candidate.riskFlags?.length > 0).length,
  });

  return {
    ok: true,
    commandName: 'cashflowSheetLab.stage.firebase',
    projectId,
    spreadsheetId: preview.spreadsheetId,
    spreadsheetTitle: preview.spreadsheetTitle,
    selectedSheetName: preview.selectedSheetName,
    activeWeekRange: {
      startWeek: weekRange.startWeek,
      endWeek: weekRange.endWeek,
      weekBasis: CASHFLOW_WEEK_BASIS,
      totalBasis: CASHFLOW_WEEK_BASIS,
      activeWeeks,
    },
    runId,
    stagedLineCount: candidates.length,
    projectionLineCount,
    actualLineCount,
    riskLineCount: candidates.filter((candidate) => candidate.riskFlags?.length > 0).length,
    skippedInvalidWeekCount: skippedInvalidWeekKeys.length,
    skippedInvalidWeeks: skippedInvalidWeekKeys,
    candidates,
    omittedCandidateCount: 0,
    lastStagedAt: now,
    lastStagedBy: {
      uid: readOptionalText(context?.actorId),
      email: readOptionalText(context?.actorEmail),
      role: readOptionalText(context?.actorRole) || 'workspace_user',
    },
  };
}

function createSheetPreviewLoader({ googleSheetsService, cacheTtlMs = DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS } = {}) {
  const cache = new Map();
  const inFlight = new Map();

  function cacheKey({ value, sheetName }) {
    return JSON.stringify({
      value: readOptionalText(value),
      sheetName: readOptionalText(sheetName),
      rangeA1: CASHFLOW_SHEET_LAB_READ_RANGE,
      auth: 'service',
    });
  }

  return async function loadSheetPreview(params) {
    const key = cacheKey(params);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cacheStatus: 'hit' };
    }

    const running = inFlight.get(key);
    if (running) {
      const value = await running;
      return { ...value, cacheStatus: 'in_flight_join' };
    }

    async function requestPreview(sheetName) {
      return googleSheetsService.previewSpreadsheet({
        value: params.value,
        sheetName,
        rangeA1: CASHFLOW_SHEET_LAB_READ_RANGE,
      });
    }

    const request = (async () => {
      const authMode = 'service_account';
      const first = await requestPreview(params.sheetName);
      if (params.sheetName || isCashflowUsageLinkedSheetName(first.selectedSheetName)) {
        return { ...first, authMode };
      }
      const linkedSheet = findCashflowUsageLinkedSheet(first.availableSheets);
      if (!linkedSheet) return { ...first, authMode };
      const linkedPreview = await requestPreview(linkedSheet.title);
      return { ...linkedPreview, authMode };
    })();
    inFlight.set(key, request);
    try {
      const value = await request;
      if (cacheTtlMs > 0) {
        cache.set(key, {
          value,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
      return { ...value, cacheStatus: 'miss' };
    } finally {
      inFlight.delete(key);
    }
  };
}

export function mountCashflowSheetLabRoutes(app, {
  db,
  googleSheetsService,
  enabled = true,
  env = process.env,
  editLeasesEnabled,
  javaWeeklyClient,
  workspaceEmailDomain = 'mysc.co.kr',
  sheetPreviewCacheTtlMs = DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS,
} = {}) {
  if (enabled === false) {
    app.use('/api/v1/projects/:projectId/cashflow-sheet-lab', (_req, res) => {
      res.status(404).json({
        code: 'cashflow_sheet_lab_not_available',
        message: 'Cashflow sheet lab is not available on this deployment surface.',
      });
    });
    return;
  }

  const loadSheetPreview = createSheetPreviewLoader({
    googleSheetsService,
    cacheTtlMs: sheetPreviewCacheTtlMs,
  });
  const authoritativeWritesEnabled = typeof editLeasesEnabled === 'boolean'
    ? editLeasesEnabled
    : readOptionalText(env.BFF_EDIT_LEASES_ENABLED).toLowerCase() === 'true';
  const authoritativeJavaClient = authoritativeWritesEnabled
    ? (javaWeeklyClient || createJavaWeeklyClient({ env }))
    : null;
  const systemAccountEmail = resolveSystemAccountEmail(googleSheetsService);

  app.get('/api/v1/projects/:projectId/cashflow-sheet-lab/config', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const project = await readProjectDocument(db, tenantId, projectId);
    const config = await hydrateCashflowSheetLabConfigTitle(readCashflowSheetLabConfig(project), googleSheetsService);
    res.status(200).json(buildConfigResponse(projectId, config, systemAccountEmail));
  }));

  app.put('/api/v1/projects/:projectId/cashflow-sheet-lab/config', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabConfigSchema, req.body, 'Invalid cashflow sheet lab config payload');
    normalizeWeekRange(parsed);
    logCashflowSheetLab('config.save.start', req, {
      projectId,
      authMode: 'bff_config_only',
      sheetName: parsed.sheetName || null,
      valueProvided: Boolean(parsed.value),
      startWeek: parsed.startWeek || null,
      endWeek: parsed.endWeek || null,
    });

    const project = await readProjectDocument(db, tenantId, projectId);

    try {
      const config = await saveCashflowSheetLabConfig({
        db,
        tenantId,
        projectId,
        parsed,
        context: req.context,
        existingConfig: readCashflowSheetLabConfig(project),
      });
      logCashflowSheetLab('config.save.ok', req, {
        projectId,
        authMode: 'bff_config_only',
        spreadsheetId: config.spreadsheetId,
        selectedSheetName: config.sheetName,
        weekBasis: CASHFLOW_WEEK_BASIS,
      });
      res.status(200).json(buildConfigResponse(projectId, config, systemAccountEmail));
    } catch (error) {
      logCashflowSheetLab('config.save.error', req, {
        projectId,
        authMode: 'bff_config_only',
        ...routeErrorDetails(normalizeRouteError(error)),
      }, 'warn');
      throw normalizeRouteError(error);
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/preview', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabPreviewSchema, req.body, 'Invalid cashflow sheet lab preview payload');
    const project = await readProjectDocument(db, tenantId, projectId);
    const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
    const weekRange = normalizeWeekRange(source);
    const deprecatedGoogleAccessTokenIgnored = Boolean(readOptionalText(req.header('x-google-access-token')));
    logCashflowSheetLab('preview.start', req, {
      projectId,
      authMode: 'service_account',
      deprecatedGoogleAccessTokenIgnored,
      source: source.source,
      sheetName: source.sheetName || null,
      valueProvided: Boolean(source.value),
      includeValues: parsed.includeValues !== false,
      startWeek: weekRange.startWeek || null,
      endWeek: weekRange.endWeek || null,
    });

    try {
      const preview = await loadSheetPreview({
        value: source.value,
        sheetName: source.sheetName,
      });
      const authMode = resolveGoogleSheetAuthMode(preview);
      assertCashflowUsageLinkedSheet(preview);
      const template = analyzeCashflowSheetTemplate(preview.matrix);
      assertConfiguredWeekRangeExistsInTemplate(template, weekRange);

      const cashflowSnapshot = parsed.includeValues === false
        ? null
        : await readCashflowWeeksSnapshot(db, tenantId, projectId);
      const cashflowSnapshotStatus = parsed.includeValues === false ? 'pending' : 'ready';

      const previewValues = buildPreviewValues(template, cashflowSnapshot, preview.matrix)
        .filter((value) => isInWeekRange(value, weekRange));
      const activeWeeks = buildActiveWeeksFromTemplate(template, weekRange);
      logCashflowSheetLab('preview.ok', req, {
        projectId,
        authMode,
        spreadsheetId: preview.spreadsheetId,
        selectedSheetName: preview.selectedSheetName,
        cacheStatus: preview.cacheStatus,
        templateSupported: template.supported,
        mappingCount: template.stats?.mappingCount || 0,
        previewValueCount: previewValues.length,
        cashflowSnapshotStatus,
      });

      res.status(200).json({
        projectId,
        spreadsheetId: preview.spreadsheetId,
        spreadsheetTitle: preview.spreadsheetTitle,
        selectedSheetName: preview.selectedSheetName,
        availableSheets: preview.availableSheets,
        matrix: preview.matrix,
        accessPolicy: {
          googleAuth: authMode,
          googleScope: 'spreadsheets.readonly',
          sheetPermission: resolveGoogleSheetPermission(authMode),
          layoutSource: 'google_sheet_formatted_values',
          valueSource: 'firebase_cashflow_weeks',
          actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read',
          sheetReadRange: CASHFLOW_SHEET_LAB_READ_RANGE,
          sheetPreviewCache: preview.cacheStatus,
          sheetNamePolicy: 'cashflow_usage_linked_only',
          sheetConfigSource: source.source,
          weekBasis: CASHFLOW_WEEK_BASIS,
          totalBasis: CASHFLOW_WEEK_BASIS,
        },
        activeWeekRange: {
          startWeek: weekRange.startWeek,
          endWeek: weekRange.endWeek,
          weekBasis: CASHFLOW_WEEK_BASIS,
          totalBasis: CASHFLOW_WEEK_BASIS,
          activeWeeks,
        },
        template,
        previewValues,
        cashflowSnapshotStatus,
        cashflowSnapshotError: null,
      });
    } catch (error) {
      logCashflowSheetLab('preview.error', req, {
        projectId,
        authMode: 'service_account',
        deprecatedGoogleAccessTokenIgnored,
        source: source.source,
        ...routeErrorDetails(normalizeRouteError(error)),
      }, 'warn');
      throw normalizeRouteError(error);
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/writeback/preview', asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabWritebackPreviewSchema, req.body, 'Invalid cashflow projection sheet writeback preview payload');
    const project = await readProjectDocument(db, tenantId, projectId);
    const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
    const weekRange = normalizeWeekRange(source);
    const deprecatedGoogleAccessTokenIgnored = Boolean(readOptionalText(req.header('x-google-access-token')));
    logCashflowSheetLab('writeback.preview.start', req, {
      projectId,
      authMode: 'service_account',
      deprecatedGoogleAccessTokenIgnored,
      source: source.source,
      sheetName: source.sheetName || null,
      startWeek: weekRange.startWeek || null,
      endWeek: weekRange.endWeek || null,
    });

    try {
      const preview = await loadSheetPreview({
        value: source.value,
        sheetName: source.sheetName,
      });
      assertCashflowUsageLinkedSheet(preview);
      const template = analyzeCashflowSheetTemplate(preview.matrix);
      assertConfiguredWeekRangeExistsInTemplate(template, weekRange);
      if (!template.supported) {
        throw createHttpError(
          400,
          '지원하지 않는 cashflow 시트 구조라 Projection을 시트에 반영할 수 없습니다.',
          'cashflow_sheet_template_unsupported',
        );
      }
      const cashflowSnapshot = await readCashflowWeeksSnapshot(db, tenantId, projectId);
      const plan = buildProjectionWritebackPlan(template, preview.matrix, cashflowSnapshot, weekRange);
      logCashflowSheetLab('writeback.preview.ok', req, {
        projectId,
        authMode: preview.authMode,
        spreadsheetId: preview.spreadsheetId,
        selectedSheetName: preview.selectedSheetName,
        changeCount: plan.changeCount,
        totalCellCount: plan.totalCellCount,
        baselineHash: plan.baselineHash,
        durationMs: Date.now() - startedAt,
      });
      res.status(200).json(buildProjectionWritebackResponse({
        projectId,
        preview,
        template,
        weekRange,
        plan,
        authMode: preview.authMode,
        durationMs: Date.now() - startedAt,
      }));
    } catch (error) {
      logCashflowSheetLab('writeback.preview.error', req, {
        projectId,
        authMode: 'service_account',
        deprecatedGoogleAccessTokenIgnored,
        source: source.source,
        durationMs: Date.now() - startedAt,
        ...routeErrorDetails(normalizeRouteError(error)),
      }, 'warn');
      throw normalizeRouteError(error);
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/writeback/apply', asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabWritebackApplySchema, req.body, 'Invalid cashflow projection sheet writeback apply payload');
    const project = await readProjectDocument(db, tenantId, projectId);
    const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
    const weekRange = normalizeWeekRange(source);
    const deprecatedGoogleAccessTokenIgnored = Boolean(readOptionalText(req.header('x-google-access-token')));
    const loadFreshSheetPreview = createSheetPreviewLoader({
      googleSheetsService,
      cacheTtlMs: 0,
    });
    let job = null;
    let applyAuthMode = 'service_account';

    try {
      const preview = await loadFreshSheetPreview({
        value: source.value,
        sheetName: source.sheetName,
      });
      applyAuthMode = preview.authMode || applyAuthMode;
      assertCashflowUsageLinkedSheet(preview);
      const template = analyzeCashflowSheetTemplate(preview.matrix);
      assertConfiguredWeekRangeExistsInTemplate(template, weekRange);
      if (!template.supported) {
        throw createHttpError(
          400,
          '지원하지 않는 cashflow 시트 구조라 Projection을 시트에 반영할 수 없습니다.',
          'cashflow_sheet_template_unsupported',
        );
      }
      const cashflowSnapshot = await readCashflowWeeksSnapshot(db, tenantId, projectId);
      const plan = buildProjectionWritebackPlan(template, preview.matrix, cashflowSnapshot, weekRange);
      const requestBaselineHash = readOptionalText(parsed.baselineHash);
      const conflictResolution = readOptionalText(parsed.conflictResolution) || 'abort';
      const jobPayload = {
        id: readOptionalText(parsed.idempotencyKey) || undefined,
        baselineHash: plan.baselineHash,
        requestedBaselineHash: requestBaselineHash || null,
        spreadsheetId: preview.spreadsheetId,
        selectedSheetName: preview.selectedSheetName,
        changeCount: plan.changeCount,
        totalCellCount: plan.totalCellCount,
      };

      job = await writeProjectionSyncJob({
        db,
        tenantId,
        projectId,
        requestId: req.context?.requestId || req.requestId,
        context: req.context,
        status: 'RUNNING',
        payload: {
          ...jobPayload,
          startedAt: new Date(startedAt).toISOString(),
        },
      });

      if (requestBaselineHash && requestBaselineHash !== plan.baselineHash && conflictResolution !== 'overwrite') {
        const conflictJob = await writeProjectionSyncJob({
          db,
          tenantId,
          projectId,
          requestId: req.context?.requestId || req.requestId,
          context: req.context,
          status: 'CONFLICT',
          payload: {
            ...jobPayload,
            id: job?.id,
            startedAt: new Date(startedAt).toISOString(),
            durationMs: Date.now() - startedAt,
            conflict: {
              reason: 'sheet_changed_after_preview',
              requestedBaselineHash: requestBaselineHash,
              currentBaselineHash: plan.baselineHash,
            },
          },
        });
        throw createDetailedHttpError(
          409,
          '시트가 검토 이후 변경되었습니다. 현재 시트 값을 다시 검토한 뒤 반영해 주세요.',
          'cashflow_projection_sheet_conflict',
          buildProjectionWritebackResponse({
            projectId,
            preview,
            template,
            weekRange,
            plan,
            authMode: applyAuthMode,
            job: conflictJob,
            durationMs: Date.now() - startedAt,
          }),
        );
      }

      let updateResult = { totalUpdatedCells: 0, responses: [] };
      if (plan.updates.length > 0) {
        if (typeof googleSheetsService?.batchUpdateValues !== 'function') {
          throw createHttpError(503, 'Google Sheets write service is not configured.', 'google_sheets_write_unconfigured');
        }
        async function batchUpdateProjection() {
          return googleSheetsService.batchUpdateValues({
            spreadsheetId: preview.spreadsheetId,
            sheetName: preview.selectedSheetName,
            updates: plan.updates,
          });
        }
        updateResult = await batchUpdateProjection();
      }

      const doneJob = await writeProjectionSyncJob({
        db,
        tenantId,
        projectId,
        requestId: req.context?.requestId || req.requestId,
        context: req.context,
        status: 'DONE',
        payload: {
          ...jobPayload,
          id: job?.id,
          startedAt: new Date(startedAt).toISOString(),
          durationMs: Date.now() - startedAt,
          updatedCellCount: updateResult.totalUpdatedCells,
          googleSheetsResult: {
            totalUpdatedCells: updateResult.totalUpdatedCells,
            totalUpdatedRows: updateResult.totalUpdatedRows,
            totalUpdatedColumns: updateResult.totalUpdatedColumns,
            totalUpdatedSheets: updateResult.totalUpdatedSheets,
          },
        },
      });
      logCashflowSheetLab('writeback.apply.ok', req, {
        projectId,
        authMode: applyAuthMode,
        deprecatedGoogleAccessTokenIgnored,
        spreadsheetId: preview.spreadsheetId,
        selectedSheetName: preview.selectedSheetName,
        changeCount: plan.changeCount,
        updatedCellCount: updateResult.totalUpdatedCells,
        jobId: doneJob?.id || null,
        durationMs: Date.now() - startedAt,
      });
      res.status(200).json({
        ...buildProjectionWritebackResponse({
          projectId,
          preview,
          template,
          weekRange,
          plan,
          authMode: applyAuthMode,
          job: doneJob,
          durationMs: Date.now() - startedAt,
        }),
        ok: true,
        updatedCellCount: updateResult.totalUpdatedCells,
      });
    } catch (error) {
      const normalized = normalizeRouteError(error);
      if (!['cashflow_projection_sheet_conflict'].includes(normalized.code)) {
        await writeProjectionSyncJob({
          db,
          tenantId,
          projectId,
          requestId: req.context?.requestId || req.requestId,
          context: req.context,
          status: 'FAILED',
          payload: {
            id: job?.id,
            durationMs: Date.now() - startedAt,
            error: routeErrorDetails(normalized),
          },
        }).catch(() => null);
      }
      logCashflowSheetLab('writeback.apply.error', req, {
        projectId,
        authMode: applyAuthMode,
        durationMs: Date.now() - startedAt,
        ...routeErrorDetails(normalized),
      }, 'warn');
      throw normalized;
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/apply', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    if (!authoritativeWritesEnabled) {
      throw createHttpError(503, 'Cashflow writes require the Stage edit-lease runtime.', 'cashflow_edit_leases_disabled');
    }
    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabApplySchema, req.body, 'Invalid cashflow sheet lab apply payload');
    const project = await readProjectDocument(db, tenantId, projectId);
    const deprecatedGoogleAccessTokenIgnored = Boolean(readOptionalText(req.header('x-google-access-token')));
    const editSession = authoritativeWritesEnabled ? readEditSession(req) : null;
    const idempotencyKey = readOptionalText(parsed.idempotencyKey) || readOptionalText(req.context?.idempotencyKey);
    if (authoritativeWritesEnabled && !idempotencyKey) {
      throw createHttpError(400, 'idempotencyKey is required for cashflow apply.', 'idempotency_key_required');
    }

    try {
      const stagedRunId = readOptionalText(parsed.stageRunId);
      const result = stagedRunId ? await applyStagedCashflowSheetLab({
        db,
        tenantId,
        projectId,
        parsed,
        context: req.context,
        javaWeeklyClient: authoritativeJavaClient,
        editSession,
        idempotencyKey,
        logger: (event, details = {}, level = 'info') => {
          logCashflowSheetLab(`apply.${event}`, req, details, level);
        },
      }) : await applyConfiguredCashflowSheetLab({
        db,
        tenantId,
        projectId,
        project,
        parsed,
        loadSheetPreview,
        context: req.context,
        javaWeeklyClient: authoritativeJavaClient,
        editSession,
        idempotencyKey,
        logger: (event, details = {}, level = 'info') => {
          logCashflowSheetLab(`apply.${event}`, req, details, level);
        },
      });
      res.status(200).json(result);
    } catch (error) {
      logCashflowSheetLab('apply.error', req, {
        projectId,
        authMode: 'service_account',
        deprecatedGoogleAccessTokenIgnored,
        ...routeErrorDetails(normalizeRouteError(error)),
      }, 'warn');
      throw normalizeRouteError(error);
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/stage', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabApplySchema, req.body, 'Invalid cashflow sheet lab stage payload');
    const project = await readProjectDocument(db, tenantId, projectId);

    try {
      const result = await stageConfiguredCashflowSheetLab({
        db,
        tenantId,
        projectId,
        project,
        parsed,
        loadSheetPreview,
        context: req.context,
        logger: (event, details = {}, level = 'info') => {
          logCashflowSheetLab(`stage.${event}`, req, details, level);
        },
      });
      res.status(200).json(result);
    } catch (error) {
      logCashflowSheetLab('stage.error', req, {
        projectId,
        authMode: 'service_account',
        ...routeErrorDetails(normalizeRouteError(error)),
      }, 'warn');
      throw normalizeRouteError(error);
    }
  }));
}

function normalizeSyncTenantIds(value) {
  const raw = Array.isArray(value) ? value.join(',') : readOptionalText(value);
  const parsed = raw
    .split(',')
    .map((tenantId) => readOptionalText(tenantId))
    .filter(Boolean);
  return parsed.length > 0 ? [...new Set(parsed)] : ['mysc'];
}

async function listConfiguredCashflowProjects({ db, tenantId, projectId, limit }) {
  if (projectId) {
    const snap = await db.doc(projectDocPath(tenantId, projectId)).get();
    if (!snap.exists) return [];
    return [{ id: projectId, ...(snap.data() || {}) }];
  }

  const snap = await db.collection(`orgs/${tenantId}/projects`).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((project) => Boolean(readCashflowSheetLabConfig(project)))
    .slice(0, limit);
}

export async function runCashflowSheetLabSyncWorker({
  db,
  googleSheetsService,
  tenantIds,
  tenantId,
  projectId,
  limit = 100,
  nowIso = new Date().toISOString(),
  sheetPreviewCacheTtlMs = 0,
  env = process.env,
  editLeasesEnabled,
} = {}) {
  const authoritativeWritesEnabled = typeof editLeasesEnabled === 'boolean'
    ? editLeasesEnabled
    : readOptionalText(env.BFF_EDIT_LEASES_ENABLED).toLowerCase() === 'true';
  if (authoritativeWritesEnabled) {
    throw createHttpError(503, 'Automatic cashflow writes are disabled while project edit leases are active.', 'cashflow_sync_requires_edit_lease');
  }
  if (!db) {
    throw createHttpError(503, 'Firestore is required to sync cashflow sheets.', 'firestore_unconfigured');
  }
  if (!googleSheetsService) {
    throw createHttpError(503, 'Google Sheets service is required to sync cashflow sheets.', 'google_sheets_unconfigured');
  }

  const resolvedTenantIds = normalizeSyncTenantIds(tenantIds || tenantId || 'mysc');
  const resolvedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.trunc(Number(limit)))) : 100;
  const loadSheetPreview = createSheetPreviewLoader({
    googleSheetsService,
    cacheTtlMs: sheetPreviewCacheTtlMs,
  });
  const context = {
    actorId: 'cashflow-sheet-sync-worker',
    actorEmail: 'cashflow-sheet-sync@mysc.co.kr',
    actorRole: 'system',
  };

  const results = [];
  const failures = [];
  let scanned = 0;

  for (const currentTenantId of resolvedTenantIds) {
    const projects = await listConfiguredCashflowProjects({
      db,
      tenantId: currentTenantId,
      projectId: readOptionalText(projectId),
      limit: resolvedLimit,
    });
    scanned += projects.length;

    for (const project of projects) {
      const currentProjectId = readOptionalText(project.id);
      if (!currentProjectId || !readCashflowSheetLabConfig(project)) continue;
      try {
        const result = await applyConfiguredCashflowSheetLab({
          db,
          tenantId: currentTenantId,
          projectId: currentProjectId,
          project,
          parsed: {},
          loadSheetPreview,
          context,
          logger: (event, details = {}, level = 'info') => {
            const write = typeof console[level] === 'function' ? console[level] : console.info;
            write('[CashflowSheetLabSync]', event, {
              tenantId: currentTenantId,
              projectId: currentProjectId,
              nowIso,
              ...details,
            });
          },
        });
        results.push({
          tenantId: currentTenantId,
          projectId: currentProjectId,
          spreadsheetId: result.spreadsheetId,
          selectedSheetName: result.selectedSheetName,
          appliedLineCount: result.appliedLineCount,
          projectionLineCount: result.projectionLineCount,
          actualLineCount: result.actualLineCount,
          verifiedLineCount: result.verifiedLineCount,
          updatedWeekCount: result.firebaseResult?.updatedWeeks?.length || 0,
        });
      } catch (error) {
        const normalized = normalizeRouteError(error);
        failures.push({
          tenantId: currentTenantId,
          projectId: currentProjectId,
          statusCode: normalized.statusCode || 500,
          code: normalized.code || normalized.name || 'error',
          message: normalized.message || 'Unknown error',
        });
        console.warn('[CashflowSheetLabSync] project.failed', failures[failures.length - 1]);
      }
    }
  }

  return {
    ok: failures.length === 0,
    worker: 'cashflow_sheet_sync',
    schedule: 'daily_18_00_kst',
    nowIso,
    tenantIds: resolvedTenantIds,
    projectId: readOptionalText(projectId) || null,
    scanned,
    attempted: results.length + failures.length,
    applied: results.length,
    failed: failures.length,
    results,
    failures,
  };
}
