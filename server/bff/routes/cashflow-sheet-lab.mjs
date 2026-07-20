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
import { computeCashflowTargetRevision, createCashflowPinnedSnapshot } from '../cashflow-sheet-snapshot.mjs';
import { CASHFLOW_ALL_LINES } from '../cashflow-policy.mjs';
import { createJavaWeeklyClient } from '../java-weekly-client.mjs';
import { getMonthFinanceWeeks } from '../../../src/app/platform/cashflow-week-core.mjs';
import {
  cashflowSheetLabApplySchema,
  cashflowSheetLabConfigSchema,
  cashflowSheetLabMirrorRefreshSchema,
  cashflowSheetLabStageSchema,
  parseWithSchema,
} from '../schemas.mjs';

const CASHFLOW_SHEET_LAB_READ_RANGE = 'A1:ZZ220';
const DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS = 15_000;
const CASHFLOW_USAGE_SHEET_NAME_PARTS = ['cashflow', '사용내역', '연동'];
const CASHFLOW_WEEK_BASIS = 'sheet_range';
const CASHFLOW_WEEKS_COLLECTION_ID = 'cashflow_weeks';
const CASHFLOW_CHANGE_CANDIDATES_COLLECTION_ID = 'cashflow_change_candidates';
const CASHFLOW_SHEET_MIRRORS_COLLECTION_ID = 'cashflow_sheet_mirrors';
const CASHFLOW_SHEET_SNAPSHOTS_COLLECTION_ID = 'cashflow_sheet_snapshots';
const CASHFLOW_SHEET_SNAPSHOT_MONTHS_COLLECTION_ID = 'cashflow_sheet_snapshot_months';
const CASHFLOW_SHEET_SNAPSHOT_YEARS_COLLECTION_ID = 'cashflow_sheet_snapshot_years';
const CASHFLOW_SHEET_REFRESH_RUNS_COLLECTION_ID = 'cashflow_sheet_refresh_runs';
const CASHFLOW_SHEET_STAGE_RUNS_COLLECTION_ID = 'cashflow_sheet_stage_runs';
const CASHFLOW_SHEET_STAGE_MONTHS_COLLECTION_ID = 'cashflow_sheet_stage_months';
const CASHFLOW_MODES = ['projection', 'actual'];
const CASHFLOW_SHEET_SOURCE_KEY = 'cashflow-sheet-lab';
const CASHFLOW_LINE_ORDER = new Map(CASHFLOW_ALL_LINES.map((lineId, index) => [lineId, index]));
const FINANCIAL_YEAR_FIELDS = [
  'contractAmount',
  'salesVatAmount',
  'totalRevenueAmount',
  'supportAmount',
];

function wholeWon(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function attachFinancialYearChecks(mirror, project) {
  if (mirror?.status !== 'FRESH') return mirror;
  const registeredYears = Array.isArray(project?.financialYears)
    ? project.financialYears
      .filter((row) => Number.isSafeInteger(row?.year))
      .sort((left, right) => left.year - right.year)
    : [];
  if (registeredYears.length < 2) return mirror;

  const sheetYears = new Map((mirror.sheetFacts?.annualFinancialTotals || [])
    .filter((row) => Number.isSafeInteger(row?.year))
    .map((row) => [row.year, row]));
  const compare = (year, registered, sheet) => {
    const mismatches = FINANCIAL_YEAR_FIELDS.filter((field) => (
      !sheet || wholeWon(registered[field]) !== wholeWon(sheet[field])
    ));
    return {
      year,
      status: sheet ? (mismatches.length === 0 ? 'MATCH' : 'MISMATCH') : 'SHEET_YEAR_MISSING',
      mismatches,
      registered: Object.fromEntries(FINANCIAL_YEAR_FIELDS.map((field) => [field, wholeWon(registered[field])])),
      sheet: Object.fromEntries(FINANCIAL_YEAR_FIELDS.map((field) => [field, wholeWon(sheet?.[field])])),
    };
  };
  const years = registeredYears.map((registered) => compare(registered.year, registered, sheetYears.get(registered.year)));
  const totalRegistered = Object.fromEntries(FINANCIAL_YEAR_FIELDS.map((field) => [field,
    years.reduce((sum, row) => sum + row.registered[field], 0),
  ]));
  const totalSheet = Object.fromEntries(FINANCIAL_YEAR_FIELDS.map((field) => [field,
    years.reduce((sum, row) => sum + row.sheet[field], 0),
  ]));
  const totalMismatches = FINANCIAL_YEAR_FIELDS.filter((field) => totalRegistered[field] !== totalSheet[field]);

  return {
    ...mirror,
    financialYearChecks: {
      years,
      total: {
        status: years.some((row) => row.status === 'SHEET_YEAR_MISSING')
          ? 'SHEET_YEAR_MISSING'
          : (totalMismatches.length === 0 ? 'MATCH' : 'MISMATCH'),
        mismatches: totalMismatches,
        registered: totalRegistered,
        sheet: totalSheet,
      },
    },
  };
}

function readSelectedYear(value) {
  const text = readOptionalText(value);
  const year = /^\d{4}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(year)) {
    throw createHttpError(400, 'selectedYear must be a four-digit year.', 'cashflow_selected_year_invalid');
  }
  return year;
}

function cashflowAvailableYears(mirror, project, selectedYear) {
  return [...new Set([
    selectedYear - 1,
    selectedYear,
    selectedYear + 1,
    ...(Array.isArray(project?.financialYears) ? project.financialYears.map((row) => Number(row?.year)) : []),
    ...(Array.isArray(mirror?.years) ? mirror.years.map(Number) : []),
    ...(mirror?.sheetFacts?.annualCashflowTotals || []).map((row) => Number(row?.year)),
  ].filter(Number.isSafeInteger))].sort((left, right) => left - right);
}

function cashflowReadModelHash(value) {
  const canonicalize = (item) => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item)
      .sort()
      .map((key) => [key, canonicalize(item[key])]));
  };
  return stableHash(canonicalize(value));
}

async function readCashflowSheetYearView({ db, tenantId, projectId, project, selectedYear }) {
  const mirror = await readCashflowSheetMirror(db, tenantId, projectId);
  const availableYears = cashflowAvailableYears(mirror, project, selectedYear);
  const navigationYears = [selectedYear - 1, selectedYear, selectedYear + 1];
  if (!mirror?.sourceRevision) {
    return {
      projectId,
      status: 'EMPTY',
      selectedYear,
      availableYears,
      navigationYears,
      years: [],
      readModelStatus: 'EMPTY',
      fallbackYears: [],
      mismatchYears: [],
    };
  }

  const snapshotId = readOptionalText(mirror.snapshotId);
  const mirrorTotals = new Map((mirror.sheetFacts?.annualCashflowTotals || [])
    .filter((row) => Number.isSafeInteger(row?.year))
    .map((row) => [row.year, row]));
  const snapshotEnabled = /^cfsnap_[a-f0-9]{32}$/.test(snapshotId);
  const snapshotDocs = snapshotEnabled
    ? await Promise.all(availableYears.map(async (year) => {
      const snap = await db.doc(cashflowSheetSnapshotYearDocPath(tenantId, snapshotId, year)).get();
      return [year, snap.exists ? snap.data() || {} : null];
    }))
    : [];
  const snapshotTotals = new Map(snapshotDocs);
  const fallbackYears = [];
  const mismatchYears = [];
  const years = availableYears.flatMap((year) => {
    const mirrorTotal = mirrorTotals.get(year);
    const snapshotTotal = snapshotTotals.get(year);
    const snapshotCurrent = snapshotTotal
      && readOptionalText(snapshotTotal.snapshotId) === snapshotId
      && readOptionalText(snapshotTotal.projectId) === projectId
      && readOptionalText(snapshotTotal.sourceRevision) === readOptionalText(mirror.sourceRevision)
      && Number(snapshotTotal.year) === year;
    if (snapshotCurrent) {
      if (mirrorTotal && cashflowReadModelHash({ projection: snapshotTotal.projection, actual: snapshotTotal.actual })
        !== cashflowReadModelHash({ projection: mirrorTotal.projection, actual: mirrorTotal.actual })) {
        mismatchYears.push(year);
      }
      return [{
        year,
        projection: snapshotTotal.projection,
        actual: snapshotTotal.actual,
        sourceRevision: snapshotTotal.sourceRevision,
        capturedAt: snapshotTotal.capturedAt,
        storage: 'SNAPSHOT',
      }];
    }
    if (!mirrorTotal) return [];
    fallbackYears.push(year);
    return [{
      ...mirrorTotal,
      sourceRevision: mirror.sourceRevision,
      capturedAt: mirror.capturedAt,
      storage: 'MIRROR_FALLBACK',
    }];
  });

  return {
    projectId,
    status: readOptionalText(mirror.status) || 'FRESH',
    selectedYear,
    availableYears,
    navigationYears,
    snapshotId: snapshotEnabled ? snapshotId : undefined,
    sourceRevision: mirror.sourceRevision,
    capturedAt: mirror.capturedAt,
    years,
    readModelStatus: mismatchYears.length > 0 ? 'MISMATCH' : fallbackYears.length > 0 ? 'FALLBACK' : 'CURRENT',
    fallbackYears,
    mismatchYears,
  };
}

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

function hasEditLeaseHeaders(req) {
  return [
    'x-edit-session-id',
    'x-edit-lease-id',
    'x-edit-fence',
    'x-edit-finalize',
  ].some((header) => Boolean(readOptionalText(req.header(header))));
}

async function acquireSheetLabApplyLease({ editLeaseService, req, tenantId, projectId }) {
  if (!editLeaseService) {
    throw createHttpError(503, 'Cashflow final apply requires the Stage edit-lease runtime.', 'cashflow_edit_leases_disabled');
  }
  const sessionId = `cashflow-sheet-lab:${randomUUID()}`;
  const acquired = await editLeaseService.acquire({
    tenantId,
    actorId: req.context?.actorId,
    actorDisplayName: readOptionalText(req.context?.actorName) || readOptionalText(req.context?.actorEmail) || '사용자',
    sessionId,
    resourceType: 'cashflow',
    resourceId: projectId,
    requestId: req.context?.requestId,
  });
  const lease = acquired?.body || acquired;
  return {
    sessionId,
    leaseId: readOptionalText(lease?.leaseId),
    fence: Number(lease?.fence),
    finalize: true,
  };
}

async function releaseSheetLabApplyLease({ editLeaseService, req, tenantId, projectId, editSession }) {
  if (!editLeaseService || !editSession?.sessionId || !editSession?.leaseId || !Number.isSafeInteger(editSession?.fence)) return;
  try {
    await editLeaseService.release({
      tenantId,
      actorId: req.context?.actorId,
      actorDisplayName: readOptionalText(req.context?.actorName) || readOptionalText(req.context?.actorEmail) || '사용자',
      sessionId: editSession.sessionId,
      resourceType: 'cashflow',
      resourceId: projectId,
      leaseId: editSession.leaseId,
      fence: editSession.fence,
      requestId: req.context?.requestId,
    });
  } catch (error) {
    logCashflowSheetLab('apply.temporary_lease.release_failed', req, routeErrorDetails(error), 'warn');
  }
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

function cashflowSheetMirrorDocPath(tenantId, projectId) {
  return `orgs/${tenantId}/${CASHFLOW_SHEET_MIRRORS_COLLECTION_ID}/${projectId}`;
}

function cashflowSheetSnapshotDocPath(tenantId, snapshotId) {
  return `orgs/${tenantId}/${CASHFLOW_SHEET_SNAPSHOTS_COLLECTION_ID}/${snapshotId}`;
}

function cashflowSheetSnapshotMonthDocPath(tenantId, snapshotId, yearMonth) {
  return `orgs/${tenantId}/${CASHFLOW_SHEET_SNAPSHOT_MONTHS_COLLECTION_ID}/${snapshotId}_${readOptionalText(yearMonth).replace('-', '_')}`;
}

function cashflowSheetSnapshotYearDocPath(tenantId, snapshotId, year) {
  return `orgs/${tenantId}/${CASHFLOW_SHEET_SNAPSHOT_YEARS_COLLECTION_ID}/${snapshotId}_${Number(year)}`;
}

function cashflowSheetRefreshRunDocPath(tenantId, projectId, idempotencyKey) {
  const runId = `cfrefresh_${stableHash({ tenantId, projectId, idempotencyKey }).slice(0, 32)}`;
  return `orgs/${tenantId}/${CASHFLOW_SHEET_REFRESH_RUNS_COLLECTION_ID}/${runId}`;
}

function cashflowSheetStageMonthDocPath(tenantId, runId, yearMonth) {
  const monthKey = readOptionalText(yearMonth).replace('-', '_');
  return `orgs/${tenantId}/${CASHFLOW_SHEET_STAGE_MONTHS_COLLECTION_ID}/${runId}_${monthKey}`;
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

function computeCashflowSheetConfigRevision(config = {}) {
  const weekRange = normalizeWeekRange(config);
  const rawValue = readOptionalText(config?.value);
  return `sha256:${stableHash({
    spreadsheetId: extractSpreadsheetId(rawValue) || rawValue,
    sheetName: readOptionalText(config?.sheetName),
    startWeek: weekRange.startWeek,
    endWeek: weekRange.endWeek,
  })}`;
}

function assertFreshCashflowSheetMirror(mirror) {
  if (readOptionalText(mirror?.status) === 'FRESH' && readOptionalText(mirror?.configRevision)) return;
  if (readOptionalText(mirror?.lastRefreshError?.code) === 'cashflow_sheet_config_changed'
    || (readOptionalText(mirror?.status) === 'FRESH' && !readOptionalText(mirror?.configRevision))) {
    throw createHttpError(
      409,
      '시트 설정이 변경되었습니다. 최신값을 다시 가져온 뒤 검토해 주세요.',
      'cashflow_sheet_config_changed',
    );
  }
  throw createHttpError(
    409,
    '최근 시트 연동이 실패했습니다. 최신값을 다시 가져온 뒤 검토해 주세요.',
    'cashflow_sheet_mirror_stale',
  );
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
  const configRevision = computeCashflowSheetConfigRevision(config);
  const projectRef = db.doc(projectDocPath(tenantId, projectId));
  const mirrorRef = db.doc(cashflowSheetMirrorDocPath(tenantId, projectId));
  await db.runTransaction(async (transaction) => {
    const mirrorSnap = await transaction.get(mirrorRef);
    const mirror = mirrorSnap.exists ? mirrorSnap.data() || {} : null;
    transaction.set(projectRef, stripUndefinedDeep({
      cashflowSheetLab: config,
      updatedAt: now,
    }), { merge: true });
    const hasInstalledSource = Boolean(readOptionalText(mirror?.sourceRevision));
    const installedConfigMismatch = hasInstalledSource
      && readOptionalText(mirror?.configRevision) !== configRevision;
    const pendingConfigRevision = readOptionalText(mirror?.pendingRefreshConfigRevision);
    const pendingConfigMismatch = Boolean(pendingConfigRevision)
      && pendingConfigRevision !== configRevision;
    if (installedConfigMismatch || pendingConfigMismatch) {
      const latestRefreshGeneration = Math.max(0, Number(mirror.latestRefreshGeneration) || 0) + 1;
      const invalidation = {
        status: hasInstalledSource
          ? (installedConfigMismatch ? 'STALE' : readOptionalText(mirror.status) || 'STALE')
          : 'EMPTY',
        latestRefreshGeneration,
        pendingRefreshConfigRevision: null,
        lastRefreshAttemptAt: now,
      };
      if (installedConfigMismatch || !hasInstalledSource) {
        invalidation.lastRefreshError = {
          code: 'cashflow_sheet_config_changed',
          message: '시트 설정이 변경되었습니다. 최신값을 다시 가져와 주세요.',
          statusCode: 409,
          at: now,
        };
      }
      transaction.set(mirrorRef, stripUndefinedDeep(invalidation), { merge: true });
    }
  });
  return config;
}

async function saveCashflowChangeCandidates({ db, tenantId, candidates }) {
  if (!db || candidates.length === 0) return;
  for (let offset = 0; offset < candidates.length; offset += 450) {
    await Promise.all(candidates.slice(offset, offset + 450).map((candidate) => {
      const id = `cfc_${stableHash({
        runId: candidate.runId,
        projectId: candidate.projectId,
        mode: candidate.mode,
        yearMonth: candidate.yearMonth,
        weekNo: candidate.weekNo,
        lineId: candidate.lineId,
      }).slice(0, 32)}`;
      return db.doc(`orgs/${tenantId}/${CASHFLOW_CHANGE_CANDIDATES_COLLECTION_ID}/${id}`).set(stripUndefinedDeep({ ...candidate, id }));
    }));
  }
}

async function readCashflowChangeCandidatesByRun({ db, tenantId, projectId, runId }) {
  if (!db) return [];
  const snap = await db.collection(`orgs/${tenantId}/${CASHFLOW_CHANGE_CANDIDATES_COLLECTION_ID}`)
    .where('runId', '==', runId)
    .get();
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

async function readCashflowSheetMirror(db, tenantId, projectId) {
  if (!db) {
    throw createHttpError(503, 'Firestore is required to read the cashflow sheet mirror.', 'firestore_unconfigured');
  }
  const snap = await db.doc(cashflowSheetMirrorDocPath(tenantId, projectId)).get();
  return snap.exists ? snap.data() : null;
}

async function readCashflowSheetStageRun(db, tenantId, projectId, runId) {
  if (!/^cfstage_[a-f0-9]{32}$/.test(readOptionalText(runId))) {
    throw createHttpError(400, '유효한 시트 검토 runId가 필요합니다.', 'cashflow_sheet_stage_run_invalid');
  }
  const snap = await db.doc(`orgs/${tenantId}/${CASHFLOW_SHEET_STAGE_RUNS_COLLECTION_ID}/${runId}`).get();
  if (!snap.exists) {
    throw createHttpError(404, '시트 검토 run을 찾을 수 없습니다.', 'cashflow_sheet_stage_run_not_found');
  }
  const run = snap.data() || {};
  if (readOptionalText(run.projectId) !== readOptionalText(projectId)) {
    throw createHttpError(404, '시트 검토 run을 찾을 수 없습니다.', 'cashflow_sheet_stage_run_not_found');
  }
  return run;
}

function assertStageRunRequestMatches(run, requestHash) {
  if (readOptionalText(run?.requestHash) !== requestHash) {
    throw createHttpError(409, '같은 idempotencyKey에 다른 검토 요청을 사용할 수 없습니다.', 'idempotency_key_reused');
  }
}

function stageRunInProgressError() {
  return createHttpError(409, '같은 시트 검토 요청이 이미 처리 중입니다.', 'idempotency_request_in_progress');
}

async function reserveCashflowSheetStageRun({ db, runRef, requestHash, reservation }) {
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(runRef);
    if (snap.exists) {
      const run = snap.data() || {};
      assertStageRunRequestMatches(run, requestHash);
      if (run.response) return run.response;
      const reservationExpiresAt = Date.parse(readOptionalText(run.reservationExpiresAt));
      if (readOptionalText(run.status) === 'STAGING' && reservationExpiresAt > Date.now()) {
        throw stageRunInProgressError();
      }
    }
    transaction.set(runRef, stripUndefinedDeep({
      ...reservation,
      requestHash,
      status: 'STAGING',
      reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }), { merge: true });
    return null;
  });
}

async function beginCashflowSheetRefreshRun({
  db,
  tenantId,
  projectId,
  idempotencyKey,
  requestHash,
  configRevision,
  attemptedAt,
  context,
}) {
  const runRef = db.doc(cashflowSheetRefreshRunDocPath(tenantId, projectId, idempotencyKey));
  const mirrorRef = db.doc(cashflowSheetMirrorDocPath(tenantId, projectId));
  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(runRef);
    if (snap.exists) {
      const run = snap.data() || {};
      if (readOptionalText(run.requestHash) !== requestHash) {
        throw createHttpError(
          409,
          '같은 idempotencyKey에 다른 시트 연동 요청을 사용할 수 없습니다.',
          'idempotency_key_reused',
        );
      }
      if (run.response) return { replay: run.response, generation: null };
      throw createHttpError(
        409,
        '같은 시트 연동 요청이 이미 처리 중입니다.',
        'idempotency_request_in_progress',
      );
    }
    const mirrorSnap = await transaction.get(mirrorRef);
    const mirror = mirrorSnap.exists ? mirrorSnap.data() || {} : {};
    const generation = Math.max(0, Number(mirror.latestRefreshGeneration) || 0) + 1;
    transaction.set(mirrorRef, stripUndefinedDeep({
      schemaVersion: Number(mirror.schemaVersion) || 1,
      projectId,
      status: readOptionalText(mirror.status) || 'EMPTY',
      latestRefreshGeneration: generation,
      pendingRefreshConfigRevision: configRevision,
      lastRefreshAttemptAt: attemptedAt,
    }), { merge: true });
    transaction.set(runRef, stripUndefinedDeep({
      tenantId,
      projectId,
      idempotencyKey,
      requestHash,
      configRevision,
      generation,
      status: 'IN_PROGRESS',
      createdAt: attemptedAt,
      createdBy: {
        uid: readOptionalText(context?.actorId),
        name: readOptionalText(context?.actorName),
        email: readOptionalText(context?.actorEmail),
        role: readOptionalText(context?.actorRole) || 'workspace_user',
      },
    }));
    return { replay: null, generation };
  });
  return { runRef, ...result };
}

async function completeCashflowSheetRefreshRun({
  db,
  tenantId,
  projectId,
  runRef,
  requestHash,
  generation,
  response,
  completedAt,
}) {
  const mirrorRef = db.doc(cashflowSheetMirrorDocPath(tenantId, projectId));
  return db.runTransaction(async (transaction) => {
    const runSnap = await transaction.get(runRef);
    const mirrorSnap = await transaction.get(mirrorRef);
    const run = runSnap.exists ? runSnap.data() || {} : {};
    if (readOptionalText(run.requestHash) !== requestHash) {
      throw createHttpError(
        409,
        '시트 연동 멱등 실행 정보가 변경되었습니다.',
        'idempotency_key_reused',
      );
    }
    const runGeneration = Number(run.generation);
    if (!Number.isSafeInteger(runGeneration) || runGeneration !== Number(generation)) {
      throw createHttpError(409, '시트 연동 순서 정보가 변경되었습니다.', 'cashflow_sheet_refresh_generation_conflict');
    }
    const currentMirror = mirrorSnap.exists ? mirrorSnap.data() || {} : {};
    const currentGeneration = Math.max(0, Number(currentMirror.latestRefreshGeneration) || 0);
    const superseded = currentGeneration > runGeneration;
    const runId = readOptionalText(runRef?.id) || readOptionalText(runRef?.path).split('/').pop();
    const snapshotId = `cfsnap_${stableHash({ tenantId, projectId, runId, sourceRevision: response?.sourceRevision }).slice(0, 32)}`;
    const installedResponse = superseded ? currentMirror : stripUndefinedDeep({
      ...response,
      snapshotId,
      snapshotSchemaVersion: 2,
      latestRefreshGeneration: runGeneration,
      pendingRefreshConfigRevision: null,
    });
    if (!superseded) {
      transaction.set(mirrorRef, installedResponse);
      writeCashflowSheetReadModels({ transaction, db, tenantId, projectId, mirror: installedResponse });
    }
    transaction.set(runRef, stripUndefinedDeep({
      status: 'COMPLETED',
      completedAt,
      superseded,
      response: installedResponse,
    }), { merge: true });
    return installedResponse;
  });
}

function writeCashflowSheetReadModels({ transaction, db, tenantId, projectId, mirror }) {
  if (readOptionalText(mirror?.status) !== 'FRESH') return;
  const snapshotId = readOptionalText(mirror?.snapshotId);
  if (!/^cfsnap_[a-f0-9]{32}$/.test(snapshotId)) return;
  const capturedAt = readOptionalText(mirror?.capturedAt);
  const sourceRevision = readOptionalText(mirror?.sourceRevision);
  transaction.set(db.doc(cashflowSheetSnapshotDocPath(tenantId, snapshotId)), stripUndefinedDeep({
    schemaVersion: 2,
    snapshotId,
    tenantId,
    projectId,
    status: 'INSTALLED',
    spreadsheetId: readOptionalText(mirror?.spreadsheetId),
    spreadsheetTitle: readOptionalText(mirror?.spreadsheetTitle),
    selectedSheetName: readOptionalText(mirror?.selectedSheetName),
    configRevision: readOptionalText(mirror?.configRevision),
    sourceRevision,
    targetRevisionAtFetch: readOptionalText(mirror?.targetRevisionAtFetch),
    capturedAt,
    capturedBy: mirror?.capturedBy || {},
    yearMonths: mirror?.yearMonths || [],
    years: mirror?.years || [],
    summary: mirror?.summary || {},
    activeWeekRange: mirror?.activeWeekRange || {},
  }));
  const cellsByMonth = groupPinnedCellsByMonth(mirror?.cells || []);
  for (const [yearMonth, cells] of cellsByMonth) {
    transaction.set(db.doc(cashflowSheetSnapshotMonthDocPath(tenantId, snapshotId, yearMonth)), stripUndefinedDeep({
      schemaVersion: 2,
      snapshotId,
      tenantId,
      projectId,
      yearMonth,
      source: 'cashflow_sheet_refresh',
      sourceRevision,
      capturedAt,
      cells,
    }));
  }
  for (const total of mirror?.sheetFacts?.annualCashflowTotals || []) {
    if (!Number.isSafeInteger(total?.year)) continue;
    transaction.set(db.doc(cashflowSheetSnapshotYearDocPath(tenantId, snapshotId, total.year)), stripUndefinedDeep({
      schemaVersion: 2,
      snapshotId,
      tenantId,
      projectId,
      year: total.year,
      source: 'cashflow_sheet_refresh',
      sourceRevision,
      capturedAt,
      projection: total.projection,
      actual: total.actual,
      annualCells: (mirror?.annualCells || []).filter((cell) => Number(cell?.year) === total.year),
    }));
  }
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

    const projection = week?.projection && typeof week.projection === 'object' ? week.projection : {};
    for (const [lineId, amount] of Object.entries(projection)) {
      setFiniteAmount(index, { mode: 'projection', yearMonth, weekNo, lineId }, amount);
    }

    const hasActualProvenance = Object.prototype.hasOwnProperty.call(week || {}, 'weeklyExpenseActualBySheet');
    const actualBySource = hasActualProvenance && typeof week.weeklyExpenseActualBySheet === 'object'
      ? week.weeklyExpenseActualBySheet
      : {};
    const sourceActual = actualBySource[CASHFLOW_SHEET_SOURCE_KEY]
      && typeof actualBySource[CASHFLOW_SHEET_SOURCE_KEY] === 'object'
      ? actualBySource[CASHFLOW_SHEET_SOURCE_KEY]
      : {};
    // Legacy documents have no source ledger. Compare against their aggregate so
    // every overwrite or removal is surfaced in the explicit human review.
    const sheetActual = hasActualProvenance
      ? sourceActual
      : (week?.actual && typeof week.actual === 'object' ? week.actual : {});
    for (const [lineId, amount] of Object.entries(sheetActual)) {
      setFiniteAmount(index, { mode: 'actual', yearMonth, weekNo, lineId }, amount);
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

function groupPinnedCellsByMonth(cells = []) {
  const grouped = new Map();
  for (const cell of cells) {
    const yearMonth = readOptionalText(cell?.yearMonth);
    if (!yearMonth) continue;
    const monthCells = grouped.get(yearMonth) || [];
    monthCells.push(cell);
    grouped.set(yearMonth, monthCells);
  }
  return grouped;
}

function validateCompletePinnedMonth(yearMonth, cells = []) {
  const expectedWeekNumbers = getMonthFinanceWeeks(yearMonth).map((week) => Number(week.weekNo));
  if (expectedWeekNumbers.length !== 5) return { ok: false, reason: 'invalid_year_month' };
  const expectedWeekSet = new Set(expectedWeekNumbers);
  const keys = new Set();
  const weekNumbers = new Set();
  for (const cell of cells) {
    const mode = readOptionalText(cell?.mode);
    const lineId = readOptionalText(cell?.lineId);
    const weekNo = Number(cell?.weekNo);
    const state = readOptionalText(cell?.state);
    if (
      readOptionalText(cell?.yearMonth) !== yearMonth
      || !CASHFLOW_MODES.includes(mode)
      || !CASHFLOW_LINE_ORDER.has(lineId)
      || !Number.isInteger(weekNo)
      || !expectedWeekSet.has(weekNo)
      || !['VALUE', 'EMPTY'].includes(state)
      || (state === 'VALUE' && !Number.isSafeInteger(cell?.amount))
      || (state === 'EMPTY' && cell?.amount !== undefined)
    ) {
      return { ok: false, reason: 'invalid_cell' };
    }
    const key = `${mode}:${weekNo}:${lineId}`;
    if (keys.has(key)) return { ok: false, reason: 'duplicate_cell' };
    keys.add(key);
    weekNumbers.add(weekNo);
  }

  if (weekNumbers.size === 0) return { ok: false, reason: 'empty_month' };
  for (const weekNo of expectedWeekNumbers) {
    if (!weekNumbers.has(weekNo)) return { ok: false, reason: 'incomplete_month' };
    for (const mode of CASHFLOW_MODES) {
      for (const lineId of CASHFLOW_ALL_LINES) {
        if (!keys.has(`${mode}:${weekNo}:${lineId}`)) {
          return { ok: false, reason: 'incomplete_month' };
        }
      }
    }
  }
  if (keys.size !== expectedWeekNumbers.length * CASHFLOW_MODES.length * CASHFLOW_ALL_LINES.length) {
    return { ok: false, reason: 'unexpected_cell_count' };
  }

  return {
    ok: true,
    cells: [...cells]
      .sort((left, right) => (
        Number(left.weekNo) - Number(right.weekNo)
        || CASHFLOW_MODES.indexOf(left.mode) - CASHFLOW_MODES.indexOf(right.mode)
        || CASHFLOW_LINE_ORDER.get(left.lineId) - CASHFLOW_LINE_ORDER.get(right.lineId)
      ))
      .map((cell) => stripUndefinedDeep({
        mode: cell.mode,
        weekNo: Number(cell.weekNo),
        cashflowLine: cell.lineId,
        cellState: cell.state,
        amount: cell.state === 'VALUE' ? cell.amount : undefined,
        sourceCell: readOptionalText(cell.sourceCell) || undefined,
        sourceLabel: readOptionalText(cell.sourceLabel) || cell.lineId,
      })),
  };
}

function stageMonthSnapshotDocument({ tenantId, projectId, runId, mirror, yearMonth, cells, now }) {
  return stripUndefinedDeep({
    tenantId,
    projectId,
    runId,
    yearMonth,
    configRevision: mirror.configRevision,
    sourceRevision: mirror.sourceRevision,
    targetRevisionAtFetch: mirror.targetRevisionAtFetch,
    cells,
    createdAt: now,
  });
}

async function readCashflowSheetStageMonth({ db, tenantId, projectId, runId, yearMonth }) {
  const snap = await db.doc(cashflowSheetStageMonthDocPath(tenantId, runId, yearMonth)).get();
  if (!snap.exists) {
    throw createHttpError(409, '검토 당시 고정한 월 시트 값을 찾을 수 없습니다.', 'cashflow_sheet_stage_month_missing');
  }
  const value = snap.data() || {};
  if (
    readOptionalText(value.projectId) !== readOptionalText(projectId)
    || readOptionalText(value.runId) !== readOptionalText(runId)
    || readOptionalText(value.yearMonth) !== readOptionalText(yearMonth)
  ) {
    throw createHttpError(409, '검토 당시 고정한 월 시트 값이 일치하지 않습니다.', 'cashflow_sheet_stage_month_mismatch');
  }
  return value;
}

function buildPinnedSheetChangeCandidates({ tenantId, projectId, runId, mirror, cashflowSnapshot, context, now, forceFullReplacement = false }) {
  const amountIndex = buildSnapshotAmountIndex(cashflowSnapshot);
  const weekIndex = new Map((cashflowSnapshot?.weeks || []).map((week) => [`${week.yearMonth}:${week.weekNo}`, week]));
  const blockedMonths = new Set((mirror?.cells || [])
    .filter((cell) => cell.state === 'INVALID')
    .map((cell) => readOptionalText(cell.yearMonth))
    .filter(Boolean));
  for (const [yearMonth, cells] of groupPinnedCellsByMonth(mirror?.cells || [])) {
    if (!validateCompletePinnedMonth(yearMonth, cells).ok) blockedMonths.add(yearMonth);
  }
  const closedMonths = new Set((cashflowSnapshot?.weeks || [])
    .filter((week) => (
      Boolean(week?.adminClosed)
      || readOptionalText(week?.weeklyStatusState).toLowerCase() === 'closed'
    ))
    .map((week) => readOptionalText(week?.yearMonth))
    .filter(Boolean));
  for (const yearMonth of closedMonths) blockedMonths.add(yearMonth);
  const riskLineCount = (mirror?.cells || []).filter((cell) => (
    closedMonths.has(readOptionalText(cell?.yearMonth))
    && (cell?.state === 'VALUE' || cell?.state === 'EMPTY')
  )).length;

  const candidates = (mirror?.cells || [])
    .filter((cell) => !blockedMonths.has(readOptionalText(cell.yearMonth)))
    .filter((cell) => cell.state === 'VALUE' || cell.state === 'EMPTY')
    .map((cell) => {
      const mapping = {
        mode: cell.mode,
        yearMonth: cell.yearMonth,
        weekNo: cell.weekNo,
        lineId: cell.lineId,
      };
      const beforeHadValue = hasIndexedSnapshotAmount(amountIndex, mapping);
      const beforeAmount = beforeHadValue ? normalizeAppliedAmount(readIndexedSnapshotAmount(amountIndex, mapping)) : null;
      const proposedHadValue = cell.state === 'VALUE';
      const proposedAmount = proposedHadValue ? normalizeAppliedAmount(cell.amount) : null;
      if (!forceFullReplacement && beforeHadValue === proposedHadValue && (!proposedHadValue || beforeAmount === proposedAmount)) return null;

      const week = weekIndex.get(`${cell.yearMonth}:${cell.weekNo}`);
      const riskFlags = week?.adminClosed ? ['closed_week_change'] : [];
      return {
        tenantId,
        projectId,
        runId,
        source: 'google_sheet',
        sourceRevision: mirror.sourceRevision,
        targetRevisionAtFetch: mirror.targetRevisionAtFetch,
        status: 'pending_review',
        mode: cell.mode,
        yearMonth: cell.yearMonth,
        weekNo: cell.weekNo,
        lineId: cell.lineId,
        lineDirection: cell.direction === 'IN' ? 'in' : 'out',
        beforeAmount,
        beforeHadValue,
        proposedAmount,
        proposedHadValue,
        cellState: cell.state,
        sourceCell: cell.sourceCell,
        sourceLabel: cell.sourceLabel,
        riskFlags,
        actorUid: readOptionalText(context?.actorId),
        actorName: readOptionalText(context?.actorEmail) || readOptionalText(context?.actorId),
        actorEmail: readOptionalText(context?.actorEmail),
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter(Boolean);

  return { candidates, blockedMonths: [...blockedMonths].sort(), riskLineCount };
}

function normalizeAppliedAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertApplyRequestMatches(stageRun, applyRequestHash) {
  if (readOptionalText(stageRun.applyRequestHash) !== readOptionalText(applyRequestHash)) {
    throw createHttpError(409, '다른 최종 반영 요청이 이미 이 검토본을 사용 중입니다.', 'cashflow_sheet_apply_in_progress');
  }
}

async function reserveCashflowSheetApply({ db, tenantId, projectId, stagedRunId, idempotencyKey, applyRequestHash, now }) {
  const runRef = db.doc(`orgs/${tenantId}/${CASHFLOW_SHEET_STAGE_RUNS_COLLECTION_ID}/${stagedRunId}`);
  const mirrorRef = db.doc(cashflowSheetMirrorDocPath(tenantId, projectId));
  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(runRef);
    if (!snap.exists) {
      throw createHttpError(404, '시트 검토 run을 찾을 수 없습니다.', 'cashflow_sheet_stage_run_not_found');
    }
    const stageRun = snap.data() || {};
    if (readOptionalText(stageRun.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(404, '시트 검토 run을 찾을 수 없습니다.', 'cashflow_sheet_stage_run_not_found');
    }
    const status = readOptionalText(stageRun.status);
    if (status === 'APPLIED') {
      assertApplyRequestMatches(stageRun, applyRequestHash);
      if (stageRun.applyResponse) return { replay: stageRun.applyResponse, resume: false, stageRun };
      throw createHttpError(409, '이미 반영된 시트 검토 run입니다.', 'cashflow_sheet_stage_run_applied');
    }
    if (status === 'APPLYING') {
      assertApplyRequestMatches(stageRun, applyRequestHash);
      return { replay: null, resume: true, stageRun };
    }
    if (status !== 'READY') {
      throw createHttpError(409, '반영 가능한 상태의 시트 검토 run이 아닙니다.', 'cashflow_sheet_stage_run_blocked');
    }
    const mirrorSnap = await transaction.get(mirrorRef);
    if (!mirrorSnap.exists) {
      throw createHttpError(409, '시트 고정본을 찾을 수 없습니다. 최신값을 다시 가져와 주세요.', 'cashflow_sheet_mirror_required');
    }
    const mirror = mirrorSnap.data() || {};
    assertFreshCashflowSheetMirror(mirror);
    if (
      readOptionalText(mirror.configRevision) !== readOptionalText(stageRun.configRevision)
      || readOptionalText(mirror.sourceRevision) !== readOptionalText(stageRun.sourceRevision)
      || readOptionalText(mirror.targetRevisionAtFetch) !== readOptionalText(stageRun.targetRevisionAtFetch)
    ) {
      throw createHttpError(409, '검토 후 시트 고정본이 변경되었습니다. 다시 검토해 주세요.', 'cashflow_sheet_mirror_revision_conflict');
    }
    transaction.set(runRef, stripUndefinedDeep({
      status: 'APPLYING',
      applyStartedAt: now,
      appliedIdempotencyKey: idempotencyKey,
      applyRequestHash,
    }), { merge: true });
    return {
      replay: null,
      resume: false,
      stageRun: {
        ...stageRun,
        status: 'APPLYING',
        applyStartedAt: now,
        appliedIdempotencyKey: idempotencyKey,
        applyRequestHash,
      },
    };
  });
  return { ...result, runRef };
}

async function restoreCashflowSheetApplyReady({
  db,
  runRef,
  idempotencyKey,
  applyRequestHash,
  error,
}) {
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(runRef);
    if (!snap.exists) return;
    const stageRun = snap.data() || {};
    if (
      readOptionalText(stageRun.status) !== 'APPLYING'
      || readOptionalText(stageRun.appliedIdempotencyKey) !== readOptionalText(idempotencyKey)
      || readOptionalText(stageRun.applyRequestHash) !== readOptionalText(applyRequestHash)
    ) return;
    transaction.set(runRef, stripUndefinedDeep({
      status: 'READY',
      appliedIdempotencyKey: null,
      applyRequestHash: null,
      applyFailedAt: new Date().toISOString(),
      applyFailure: routeErrorDetails(error),
    }), { merge: true });
  });
}

function monthApplyIdempotencyKey({ idempotencyKey, stagedRunId, yearMonth }) {
  return `cf-sheet-month-${stableHash({ idempotencyKey, stagedRunId, yearMonth }).slice(0, 48)}`;
}

function assertResultingTargetRevision(result) {
  const revision = readOptionalText(result?.resultingTargetRevision);
  if (!/^sha256:[a-f0-9]{64}$/.test(revision)) {
    throw createHttpError(
      502,
      'JVM 캐시플로 저장 결과의 revision을 확인할 수 없습니다.',
      'cashflow_jvm_invalid_response',
    );
  }
  return revision;
}

function summarizeJavaMonthResult(result = {}) {
  return stripUndefinedDeep({
    ok: result.ok === true,
    commandName: readOptionalText(result.commandName) || 'weeklyExpense.cashflowSheetLab.apply',
    projectId: readOptionalText(result.projectId),
    yearMonth: readOptionalText(result.yearMonth),
    sourceRevision: readOptionalText(result.sourceRevision),
    targetRevision: readOptionalText(result.targetRevision),
    resultingTargetRevision: readOptionalText(result.resultingTargetRevision),
    savedProjectionLineCount: Number(result.savedProjectionLineCount) || 0,
    savedActualLineCount: Number(result.savedActualLineCount) || 0,
    auditId: readOptionalText(result.auditId) || undefined,
  });
}

async function applyStagedCashflowSheetLab({
  db,
  tenantId,
  projectId,
  parsed = {},
  context = {},
  javaWeeklyClient = null,
  editSession = null,
  resolveEditSession = null,
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

  let stageRun = await readCashflowSheetStageRun(db, tenantId, projectId, stagedRunId);
  const replaceAllActualSources = stageRun.replaceAllActualSources === true;
  const applyRequestHash = stableHash({
    stagedRunId,
    applyRiskCandidates: Boolean(parsed.applyRiskCandidates),
    ...(replaceAllActualSources ? { replaceAllActualSources: true } : {}),
  });
  if (readOptionalText(stageRun.status) === 'APPLIED') {
    assertApplyRequestMatches(stageRun, applyRequestHash);
    if (stageRun.applyResponse) return stageRun.applyResponse;
    throw createHttpError(409, '이미 반영된 시트 검토 run입니다.', 'cashflow_sheet_stage_run_applied');
  }
  const resuming = readOptionalText(stageRun.status) === 'APPLYING';
  if (resuming) assertApplyRequestMatches(stageRun, applyRequestHash);
  if (!resuming && readOptionalText(stageRun.status) !== 'READY') {
    throw createHttpError(409, '반영 가능한 상태의 시트 검토 run이 아닙니다.', 'cashflow_sheet_stage_run_blocked');
  }
  const candidates = await readCashflowChangeCandidatesByRun({ db, tenantId, projectId, runId: stagedRunId });
  if (candidates.length === 0) {
    throw createHttpError(400, '저장할 검토 후보가 없습니다.', 'cashflow_sheet_stage_candidates_empty');
  }

  const riskCandidates = candidates.filter((candidate) => Array.isArray(candidate.riskFlags) && candidate.riskFlags.length > 0);
  const candidateMonths = [...new Set(candidates.map((candidate) => readOptionalText(candidate.yearMonth)).filter(Boolean))].sort();
  if (candidateMonths.length !== 1) {
    throw createHttpError(
      409,
      '최종 반영은 한 달 단위입니다. 한 달의 1~5주차만 다시 연동해 주세요.',
      'cashflow_sheet_stage_single_month_required',
    );
  }
  if (riskCandidates.length > 0) {
    throw createHttpError(409, '결산된 월은 다시 열기 전까지 수정할 수 없습니다.', 'cashflow_sheet_stage_closed_month');
  }
  const selectedMonths = candidateMonths;
  const selectedMonthSet = new Set(selectedMonths);
  const selectedCandidates = candidates.filter((candidate) => selectedMonthSet.has(readOptionalText(candidate.yearMonth)));

  if (!javaWeeklyClient) {
    throw createHttpError(503, 'Cashflow final apply requires the JVM authority service.', 'cashflow_jvm_authority_unavailable');
  }

  const stagedMonths = await Promise.all(selectedMonths.map(async (yearMonth) => {
    const stagedMonth = await readCashflowSheetStageMonth({ db, tenantId, projectId, runId: stagedRunId, yearMonth });
    if (
      readOptionalText(stagedMonth.configRevision) !== readOptionalText(stageRun.configRevision)
      || readOptionalText(stagedMonth.sourceRevision) !== readOptionalText(stageRun.sourceRevision)
      || readOptionalText(stagedMonth.targetRevisionAtFetch) !== readOptionalText(stageRun.targetRevisionAtFetch)
    ) {
      throw createHttpError(409, '검토 당시 고정한 월 시트 revision이 일치하지 않습니다.', 'cashflow_sheet_stage_month_revision_conflict');
    }
    const validated = validateCompletePinnedMonth(yearMonth, (stagedMonth.cells || []).map((cell) => stripUndefinedDeep({
      yearMonth,
      mode: cell.mode,
      weekNo: cell.weekNo,
      lineId: cell.cashflowLine,
      state: cell.cellState,
      amount: cell.cellState === 'VALUE' ? cell.amount : undefined,
      sourceCell: cell.sourceCell,
      sourceLabel: cell.sourceLabel,
    })));
    if (!validated.ok) {
      throw createHttpError(409, '검토 당시 고정한 월 시트 구조가 완전하지 않습니다.', 'cashflow_sheet_stage_month_incomplete');
    }
    return { yearMonth, cells: validated.cells };
  }));

  if (!resuming) {
    const mirror = await readCashflowSheetMirror(db, tenantId, projectId);
    assertFreshCashflowSheetMirror(mirror);
    if (
      readOptionalText(mirror?.configRevision) !== readOptionalText(stageRun.configRevision)
      || readOptionalText(mirror?.sourceRevision) !== readOptionalText(stageRun.sourceRevision)
    ) {
      throw createHttpError(409, '검토 후 시트 고정본이 변경되었습니다. 다시 검토해 주세요.', 'cashflow_sheet_mirror_revision_conflict');
    }
    const currentTargetSnapshot = await readCashflowWeeksSnapshot(db, tenantId, projectId);
    if (computeCashflowTargetRevision(currentTargetSnapshot) !== readOptionalText(stageRun.targetRevisionAtFetch)) {
      throw createHttpError(409, '검토 후 캐시플로우 값이 변경되었습니다. 다시 검토해 주세요.', 'cashflow_sheet_target_revision_conflict');
    }
  }

  const reservation = await reserveCashflowSheetApply({
    db,
    tenantId,
    projectId,
    stagedRunId,
    idempotencyKey,
    applyRequestHash,
    now,
  });
  if (reservation.replay) return reservation.replay;
  stageRun = reservation.stageRun;
  const effectiveIdempotencyKey = reservation.resume
    ? readOptionalText(stageRun.appliedIdempotencyKey)
    : idempotencyKey;
  if (!effectiveIdempotencyKey) {
    throw createHttpError(409, '최종 반영 재시도 키를 확인할 수 없습니다.', 'cashflow_sheet_apply_resume_invalid');
  }

  const javaResults = [];
  let targetRevision = readOptionalText(stageRun.targetRevisionAtFetch);
  try {
    const resolvedEditSession = typeof resolveEditSession === 'function'
      ? await resolveEditSession()
      : editSession;
    for (let index = 0; index < stagedMonths.length; index += 1) {
      const month = stagedMonths[index];
      const isLastMonth = index === stagedMonths.length - 1;
      const monthEditSession = resolvedEditSession
        ? { ...resolvedEditSession, finalize: isLastMonth ? Boolean(resolvedEditSession.finalize) : false }
        : null;
      const javaResult = await javaWeeklyClient.applyCashflowSheetLab({
        context,
        projectId,
        idempotencyKey: monthApplyIdempotencyKey({
          idempotencyKey: effectiveIdempotencyKey,
          stagedRunId,
          yearMonth: month.yearMonth,
        }),
        editSession: monthEditSession,
        sourceRevision: stageRun.sourceRevision,
        targetRevision,
        yearMonth: month.yearMonth,
        cells: month.cells,
        replaceAllActualSources,
      });
      targetRevision = assertResultingTargetRevision(javaResult);
      javaResults.push(javaResult);
    }
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status);
    if (javaResults.length === 0 && statusCode >= 400 && statusCode < 500) {
      await restoreCashflowSheetApplyReady({
        db,
        runRef: reservation.runRef,
        idempotencyKey: effectiveIdempotencyKey,
        applyRequestHash,
        error,
      });
    }
    throw error;
  }

  const appliedCells = stagedMonths.flatMap((month) => month.cells);
  const projectionLineCount = appliedCells.filter((cell) => cell.mode === 'projection').length;
  const actualLineCount = appliedCells.filter((cell) => cell.mode === 'actual').length;
  const response = {
    ok: true,
    commandName: 'weeklyExpense.cashflowSheetLab.apply',
    projectId,
    sourceSheetKey: CASHFLOW_SHEET_SOURCE_KEY,
    sourceRevision: stageRun.sourceRevision,
    targetRevisionAtStart: stageRun.targetRevisionAtFetch,
    resultingTargetRevision: targetRevision,
    appliedMonths: selectedMonths,
    weekBasis: CASHFLOW_WEEK_BASIS,
    totalBasis: CASHFLOW_WEEK_BASIS,
    appliedLineCount: appliedCells.length,
    projectionLineCount,
    actualLineCount,
    skippedRiskLineCount: parsed.applyRiskCandidates ? 0 : riskCandidates.length,
    lastAppliedAt: now,
    runId: `cashflow-sheet-apply:${projectId}:${now}`,
    stagedRunId,
    lastAppliedBy: {
      uid: readOptionalText(context?.actorId),
      email: readOptionalText(context?.actorEmail),
      role: readOptionalText(context?.actorRole) || 'workspace_user',
    },
    firebaseResult: {
      ok: true,
      commandName: 'weeklyExpense.cashflowSheetLab.apply',
      projectId,
      sourceRevision: stageRun.sourceRevision,
      targetRevisionAtStart: stageRun.targetRevisionAtFetch,
      resultingTargetRevision: targetRevision,
      monthResults: javaResults.map(summarizeJavaMonthResult),
      verifiedLineCount: appliedCells.length,
    },
  };
  await reservation.runRef.set({
    status: 'APPLIED',
    appliedAt: now,
    appliedIdempotencyKey: effectiveIdempotencyKey,
    applyRequestHash,
    applyResponse: response,
    appliedBy: response.lastAppliedBy,
  }, { merge: true });
  try {
    await markCashflowChangeCandidatesStatus({
      db,
      tenantId,
      candidates: selectedCandidates,
      status: 'applied',
      now,
    });
  } catch (error) {
    logger('staged.candidate_status_failed', {
      projectId,
      stagedRunId,
      ...routeErrorDetails(error),
    }, 'warn');
  }
  return response;
}

async function stagePinnedCashflowSheetLab({
  db,
  tenantId,
  projectId,
  parsed = {},
  context = {},
  logger = () => {},
} = {}) {
  logger('start', {
    projectId,
    expectedMirrorRevision: parsed.expectedMirrorRevision,
    yearMonth: parsed.yearMonth || null,
    replaceAllActualSources: Boolean(parsed.replaceAllActualSources),
  });
  const requestHash = stableHash({
    expectedMirrorRevision: parsed.expectedMirrorRevision,
    ...(parsed.yearMonth ? { yearMonth: parsed.yearMonth } : {}),
    ...(parsed.replaceAllActualSources ? { replaceAllActualSources: true } : {}),
  });
  const runId = `cfstage_${stableHash({ tenantId, projectId, idempotencyKey: parsed.idempotencyKey }).slice(0, 32)}`;
  const runRef = db.doc(`orgs/${tenantId}/${CASHFLOW_SHEET_STAGE_RUNS_COLLECTION_ID}/${runId}`);
  const mirror = await readCashflowSheetMirror(db, tenantId, projectId);
  if (!mirror?.sourceRevision) {
    throw createHttpError(409, '먼저 시트 연동하기를 실행해 주세요.', 'cashflow_sheet_mirror_required');
  }
  if (readOptionalText(mirror.sourceRevision) !== readOptionalText(parsed.expectedMirrorRevision)) {
    throw createHttpError(409, '검토 중인 시트 revision이 최신 고정본과 다릅니다.', 'cashflow_sheet_mirror_revision_conflict');
  }
  assertFreshCashflowSheetMirror(mirror);
  const configRevision = readOptionalText(mirror.configRevision);
  const existingRunSnap = await runRef.get();
  if (existingRunSnap.exists) {
    const existingRun = existingRunSnap.data() || {};
    assertStageRunRequestMatches(existingRun, requestHash);
    if (existingRun.response) return existingRun.response;
    const reservationExpiresAt = Date.parse(readOptionalText(existingRun.reservationExpiresAt));
    if (readOptionalText(existingRun.status) === 'STAGING' && reservationExpiresAt > Date.now()) {
      throw stageRunInProgressError();
    }
  }

  const pinnedCells = parsed.yearMonth
    ? (mirror.cells || []).filter((cell) => readOptionalText(cell.yearMonth) === parsed.yearMonth)
    : (mirror.cells || []);
  const pinnedMonths = [...groupPinnedCellsByMonth(pinnedCells).keys()].sort();
  if (pinnedMonths.length !== 1) {
    throw createHttpError(
      409,
      '최종 반영은 한 달 단위입니다. 한 달의 1~5주차만 다시 연동해 주세요.',
      'cashflow_sheet_stage_single_month_required',
    );
  }

  const cashflowSnapshot = await readCashflowWeeksSnapshot(db, tenantId, projectId);
  const currentTargetRevision = computeCashflowTargetRevision(cashflowSnapshot);
  if (currentTargetRevision !== readOptionalText(mirror.targetRevisionAtFetch)) {
    throw createHttpError(409, '시트 연동 후 캐시플로우 값이 변경되었습니다. 다시 연동해 주세요.', 'cashflow_sheet_target_revision_conflict');
  }
  const now = new Date().toISOString();
  const { candidates, blockedMonths, riskLineCount } = buildPinnedSheetChangeCandidates({
    tenantId,
    projectId,
    runId,
    mirror: { ...mirror, cells: pinnedCells },
    cashflowSnapshot,
    context,
    now,
    forceFullReplacement: Boolean(parsed.replaceAllActualSources),
  });
  const projectionLineCount = candidates.filter((candidate) => candidate.mode === 'projection').length;
  const actualLineCount = candidates.filter((candidate) => candidate.mode === 'actual').length;
  const cellsByMonth = groupPinnedCellsByMonth(pinnedCells);
  const stagedMonths = [...new Set(candidates.map((candidate) => candidate.yearMonth))].sort();
  const stagedMonthDocuments = stagedMonths.map((yearMonth) => {
    const validated = validateCompletePinnedMonth(yearMonth, cellsByMonth.get(yearMonth) || []);
    if (!validated.ok) {
      throw createHttpError(
        409,
        `${yearMonth} 시트 값이 월 전체 구조를 충족하지 않습니다. 월 1주차부터 다시 연동해 주세요.`,
        'cashflow_sheet_month_incomplete',
      );
    }
    return stageMonthSnapshotDocument({
      tenantId,
      projectId,
      runId,
      mirror,
      yearMonth,
      cells: validated.cells,
      now,
    });
  });
  const responseCandidates = candidates.slice(0, 200);
  const response = {
    ok: true,
    commandName: 'cashflowSheetLab.stage.firebase',
    projectId,
    spreadsheetId: mirror.spreadsheetId,
    spreadsheetTitle: mirror.spreadsheetTitle,
    selectedSheetName: mirror.selectedSheetName,
    configRevision,
    sourceRevision: mirror.sourceRevision,
    targetRevisionAtFetch: mirror.targetRevisionAtFetch,
    replaceAllActualSources: Boolean(parsed.replaceAllActualSources),
    activeWeekRange: mirror.activeWeekRange,
    runId,
    status: blockedMonths.length > 0 ? 'BLOCKED' : 'READY',
    stagedLineCount: candidates.length,
    projectionLineCount,
    actualLineCount,
    riskLineCount,
    blockedMonths,
    stagedMonths,
    candidates: responseCandidates,
    omittedCandidateCount: Math.max(0, candidates.length - responseCandidates.length),
    lastStagedAt: now,
    lastStagedBy: {
      uid: readOptionalText(context?.actorId),
      email: readOptionalText(context?.actorEmail),
      role: readOptionalText(context?.actorRole) || 'workspace_user',
    },
  };
  const runDocument = stripUndefinedDeep({
    runId,
    tenantId,
    projectId,
    idempotencyKey: parsed.idempotencyKey,
    requestHash,
    configRevision,
    sourceRevision: mirror.sourceRevision,
    targetRevisionAtFetch: mirror.targetRevisionAtFetch,
    replaceAllActualSources: Boolean(parsed.replaceAllActualSources),
    status: response.status,
    stagedLineCount: candidates.length,
    blockedMonths,
    stagedMonths,
    createdAt: now,
    createdBy: response.lastStagedBy,
  });
  const replay = await reserveCashflowSheetStageRun({
    db,
    runRef,
    requestHash,
    reservation: runDocument,
  });
  if (replay) return replay;
  try {
    await saveCashflowChangeCandidates({ db, tenantId, candidates });
    await Promise.all(stagedMonthDocuments.map((month) => db
      .doc(cashflowSheetStageMonthDocPath(tenantId, runId, month.yearMonth))
      .set(month)));
    await runRef.set(stripUndefinedDeep({
      ...runDocument,
      status: response.status,
      reservationExpiresAt: null,
      response,
    }), { merge: true });
  } catch (error) {
    await runRef.set(stripUndefinedDeep({
      status: 'STAGING_FAILED',
      reservationExpiresAt: null,
      failedAt: new Date().toISOString(),
      failure: routeErrorDetails(error),
    }), { merge: true }).catch(() => null);
    throw error;
  }
  logger('ok', {
    projectId,
    sourceRevision: mirror.sourceRevision,
    stagedLineCount: candidates.length,
    projectionLineCount,
    actualLineCount,
    riskCount: riskLineCount,
    blockedMonths,
  });
  return response;
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
    const bypassCache = params?.bypassCache === true;
    const cached = bypassCache ? null : cache.get(key);
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
      if (!bypassCache && cacheTtlMs > 0) {
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
  editLeaseService,
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
    const config = readCashflowSheetLabConfig(project);
    res.status(200).json(buildConfigResponse(projectId, config, systemAccountEmail));
  }));

  app.get('/api/v1/projects/:projectId/cashflow-sheet-lab/mirror', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    const { tenantId } = req.context;
    const { projectId } = req.params;
    const project = await readProjectDocument(db, tenantId, projectId);
    const mirror = await readCashflowSheetMirror(db, tenantId, projectId);
    res.status(200).json(attachFinancialYearChecks(mirror, project) || { projectId, status: 'EMPTY' });
  }));

  app.get('/api/v1/projects/:projectId/cashflow-sheet-lab/years', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    const { tenantId } = req.context;
    const { projectId } = req.params;
    const selectedYear = readSelectedYear(req.query.selectedYear);
    const project = await readProjectDocument(db, tenantId, projectId);
    res.status(200).json(await readCashflowSheetYearView({
      db,
      tenantId,
      projectId,
      project,
      selectedYear,
    }));
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/mirror/refresh', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(
      cashflowSheetLabMirrorRefreshSchema,
      req.body,
      'Invalid cashflow sheet mirror refresh payload',
    );
    const project = await readProjectDocument(db, tenantId, projectId);
    const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
    const weekRange = normalizeWeekRange(source);
    const configRevision = computeCashflowSheetConfigRevision({ ...source, ...weekRange });
    const previousMirror = await readCashflowSheetMirror(db, tenantId, projectId);
    const refreshRequestHash = stableHash({
      value: source.value,
      sheetName: source.sheetName || '',
      startWeek: weekRange.startWeek,
      endWeek: weekRange.endWeek,
    });
    const attemptedAt = new Date().toISOString();
    if (
      readOptionalText(previousMirror?.lastRefreshIdempotencyKey) === parsed.idempotencyKey
      && readOptionalText(previousMirror?.lastRefreshRequestHash) !== refreshRequestHash
    ) {
      throw createHttpError(409, '같은 idempotencyKey에 다른 시트 연동 요청을 사용할 수 없습니다.', 'idempotency_key_reused');
    }
    const refreshRun = await beginCashflowSheetRefreshRun({
      db,
      tenantId,
      projectId,
      idempotencyKey: parsed.idempotencyKey,
      requestHash: refreshRequestHash,
      configRevision,
      attemptedAt,
      context: req.context,
    });
    if (refreshRun.replay) {
      res.status(200).json(refreshRun.replay);
      return;
    }
    if (readOptionalText(previousMirror?.lastRefreshIdempotencyKey) === parsed.idempotencyKey) {
      const completedMirror = await completeCashflowSheetRefreshRun({
        db,
        tenantId,
        projectId,
        runRef: refreshRun.runRef,
        requestHash: refreshRequestHash,
        generation: refreshRun.generation,
        response: previousMirror,
        completedAt: attemptedAt,
      });
      res.status(200).json(completedMirror);
      return;
    }

    logCashflowSheetLab('mirror.refresh.start', req, {
      projectId,
      authMode: 'service_account',
      source: source.source,
      sheetName: source.sheetName || null,
      startWeek: weekRange.startWeek || null,
      endWeek: weekRange.endWeek || null,
    });

    try {
      const preview = await loadSheetPreview({
        value: source.value,
        sheetName: source.sheetName,
        bypassCache: true,
      });
      assertCashflowUsageLinkedSheet(preview);
      const template = analyzeCashflowSheetTemplate(preview.matrix);
      assertConfiguredWeekRangeExistsInTemplate(template, weekRange);
      if (!template.supported) {
        throw createHttpError(
          400,
          '지원하지 않는 cashflow 시트 구조라 연동할 수 없습니다.',
          'cashflow_sheet_template_unsupported',
        );
      }

      const targetSnapshot = await readCashflowWeeksSnapshot(db, tenantId, projectId);
      const mappings = template.mappingCandidates.filter((mapping) => isInWeekRange(mapping, weekRange));
      const mirror = createCashflowPinnedSnapshot({
        projectId,
        spreadsheetId: preview.spreadsheetId,
        spreadsheetTitle: preview.spreadsheetTitle,
        selectedSheetName: preview.selectedSheetName,
        mappings,
        matrix: preview.matrix,
        template,
        targetSnapshot,
        capturedAt: attemptedAt,
        capturedBy: {
          uid: req.context?.actorId,
          email: req.context?.actorEmail,
          role: req.context?.actorRole || 'workspace_user',
        },
      });
      mirror.activeWeekRange = {
        startWeek: weekRange.startWeek,
        endWeek: weekRange.endWeek,
        weekBasis: CASHFLOW_WEEK_BASIS,
        totalBasis: CASHFLOW_WEEK_BASIS,
        activeWeeks: buildActiveWeeksFromTemplate(template, weekRange),
      };
      mirror.configRevision = configRevision;
      mirror.lastRefreshAttemptAt = attemptedAt;
      mirror.lastRefreshIdempotencyKey = parsed.idempotencyKey;
      mirror.lastRefreshRequestHash = refreshRequestHash;
      const completedMirror = await completeCashflowSheetRefreshRun({
        db,
        tenantId,
        projectId,
        runRef: refreshRun.runRef,
        requestHash: refreshRequestHash,
        generation: refreshRun.generation,
        response: mirror,
        completedAt: new Date().toISOString(),
      });
      logCashflowSheetLab('mirror.refresh.ok', req, {
        projectId,
        sourceRevision: completedMirror.sourceRevision,
        targetRevisionAtFetch: completedMirror.targetRevisionAtFetch,
        ...completedMirror.summary,
      });
      res.status(200).json(completedMirror);
    } catch (error) {
      const normalized = normalizeRouteError(error);
      const lastRefreshError = {
        code: normalized?.code || normalized?.name || 'error',
        message: normalized?.message || '시트 연동에 실패했습니다.',
        statusCode: normalized?.statusCode || 500,
        at: attemptedAt,
      };
      const mirror = previousMirror?.sourceRevision
        ? {
          ...previousMirror,
          status: 'STALE',
          lastRefreshAttemptAt: attemptedAt,
          lastRefreshError,
          lastRefreshIdempotencyKey: parsed.idempotencyKey,
          lastRefreshRequestHash: refreshRequestHash,
        }
        : {
          schemaVersion: 1,
          projectId,
          status: 'ERROR',
          lastRefreshAttemptAt: attemptedAt,
          lastRefreshError,
          lastRefreshIdempotencyKey: parsed.idempotencyKey,
          lastRefreshRequestHash: refreshRequestHash,
        };
      const completedMirror = await completeCashflowSheetRefreshRun({
        db,
        tenantId,
        projectId,
        runRef: refreshRun.runRef,
        requestHash: refreshRequestHash,
        generation: refreshRun.generation,
        response: mirror,
        completedAt: new Date().toISOString(),
      });
      logCashflowSheetLab('mirror.refresh.failed', req, {
        projectId,
        mirrorStatus: completedMirror.status,
        ...routeErrorDetails(normalized),
      }, 'warn');
      res.status(200).json(completedMirror);
    }
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

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/preview', asyncHandler(async (req) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    throw createHttpError(
      410,
      '직접 시트 미리보기는 종료되었습니다. 시트 연동하기로 고정본을 만든 뒤 검토해 주세요.',
      'cashflow_sheet_direct_preview_retired',
    );
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/writeback/preview', asyncHandler(async (req) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    throw createHttpError(
      410,
      '캐시플로 시트 연동은 조회 전용입니다.',
      'cashflow_sheet_writeback_retired',
    );
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/writeback/apply', asyncHandler(async (req) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    throw createHttpError(
      410,
      '캐시플로 시트 연동은 조회 전용입니다.',
      'cashflow_sheet_writeback_retired',
    );
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
    const clientEditSession = hasEditLeaseHeaders(req) ? readEditSession(req) : null;
    const idempotencyKey = readOptionalText(parsed.idempotencyKey) || readOptionalText(req.context?.idempotencyKey);
    if (authoritativeWritesEnabled && !idempotencyKey) {
      throw createHttpError(400, 'idempotencyKey is required for cashflow apply.', 'idempotency_key_required');
    }

    let editSession = clientEditSession;
    let temporaryLeaseAcquired = false;
    let applyCompleted = false;
    try {
      const stagedRunId = readOptionalText(parsed.stageRunId);
      if (!stagedRunId) {
        throw createHttpError(
          400,
          '최종 반영 전에 시트 연동과 변경 검토가 필요합니다.',
          'cashflow_sheet_stage_run_required',
        );
      }
      const result = await applyStagedCashflowSheetLab({
        db,
        tenantId,
        projectId,
        parsed,
        context: req.context,
        javaWeeklyClient: authoritativeJavaClient,
        editSession,
        resolveEditSession: clientEditSession
          ? null
          : async () => {
            editSession = await acquireSheetLabApplyLease({
              editLeaseService,
              req,
              tenantId,
              projectId,
            });
            temporaryLeaseAcquired = true;
            return editSession;
          },
        idempotencyKey,
        logger: (event, details = {}, level = 'info') => {
          logCashflowSheetLab(`apply.${event}`, req, details, level);
        },
      });
      applyCompleted = true;
      res.status(200).json(result);
    } catch (error) {
      logCashflowSheetLab('apply.error', req, {
        projectId,
        authMode: 'service_account',
        deprecatedGoogleAccessTokenIgnored,
        ...routeErrorDetails(normalizeRouteError(error)),
      }, 'warn');
      throw normalizeRouteError(error);
    } finally {
      if (temporaryLeaseAcquired && !applyCompleted) {
        await releaseSheetLabApplyLease({
          editLeaseService,
          req,
          tenantId,
          projectId,
          editSession,
        });
      }
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/stage', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, workspaceEmailDomain);
    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabStageSchema, req.body, 'Invalid cashflow sheet lab stage payload');
    await readProjectDocument(db, tenantId, projectId);

    try {
      const result = await stagePinnedCashflowSheetLab({
        db,
        tenantId,
        projectId,
        parsed,
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
