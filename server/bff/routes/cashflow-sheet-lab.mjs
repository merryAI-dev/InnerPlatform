import {
  asyncHandler,
  createHttpError,
  ensureDocumentExists,
  readOptionalText,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { GoogleSheetsServiceError } from '../google-sheets.mjs';
import { isWorkspaceUser } from '../java-weekly-client.mjs';
import { analyzeCashflowSheetTemplate, cashflowMappingKey, parseCashflowWeekLabel } from '../cashflow-sheet-template.mjs';
import {
  cashflowSheetLabApplySchema,
  cashflowSheetLabConfigSchema,
  cashflowSheetLabPreviewSchema,
  parseWithSchema,
} from '../schemas.mjs';
import { randomUUID } from 'node:crypto';

const CASHFLOW_SHEET_LAB_READ_RANGE = 'A1:ZZ220';
const DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS = 15_000;
const CASHFLOW_USAGE_SHEET_NAME_PARTS = ['cashflow', '사용내역', '연동'];

function normalizeRole(value) {
  const normalized = readOptionalText(value).toLowerCase();
  return normalized === 'viewer' ? 'pm' : normalized;
}

function assertCashflowSheetLabAccess(req, workspaceEmailDomain = 'mysc.co.kr') {
  const actorRole = normalizeRole(req.context?.actorRole);
  if (isWorkspaceUser(req.context, workspaceEmailDomain)) return;
  throw createHttpError(
    403,
    `Workspace email is required to preview cashflow sheets lab: ${actorRole || 'unknown'}`,
    'forbidden',
  );
}

function normalizeRouteError(error) {
  if (error instanceof GoogleSheetsServiceError) {
    return createHttpError(error.statusCode, error.message, error.code);
  }
  return error;
}

function shouldReturnSnapshotUnavailable(error) {
  const code = readOptionalText(error?.code);
  return code === 'jvm_weekly_api_unconfigured'
    || code === 'jvm_weekly_api_token_unconfigured'
    || code === 'jvm_weekly_api_identity_token_unavailable';
}

function buildJavaReadContext(context, workspaceEmailDomain = 'mysc.co.kr') {
  if (!isWorkspaceUser(context, workspaceEmailDomain)) return context;
  return {
    ...context,
    actorRole: 'workspace_user',
  };
}

function assertApplyEnvironmentAligned({ bffProjectId, javaFirestoreProjectId }) {
  const bff = readOptionalText(bffProjectId);
  const javaProject = readOptionalText(javaFirestoreProjectId);
  if (!bff || !javaProject || bff !== javaProject) {
    throw createHttpError(
      409,
      'Cashflow sheet apply is blocked because BFF Firestore and Java Firestore are not aligned.',
      'cashflow_sheet_apply_environment_mismatch',
    );
  }
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
    updatedAt: readOptionalText(config.updatedAt),
    updatedBy: config.updatedBy && typeof config.updatedBy === 'object' ? {
      uid: readOptionalText(config.updatedBy.uid),
      email: readOptionalText(config.updatedBy.email),
      role: readOptionalText(config.updatedBy.role),
    } : null,
  };
}

function buildConfigResponse(projectId, config) {
  return {
    projectId,
    configured: Boolean(config),
    config,
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

async function saveCashflowSheetLabConfig({ db, tenantId, projectId, parsed, preview, context }) {
  if (!db) {
    throw createHttpError(503, 'Firestore is required to save cashflow sheet config.', 'firestore_unconfigured');
  }
  const now = new Date().toISOString();
  const config = {
    value: parsed.value,
    sheetName: preview.selectedSheetName,
    spreadsheetId: preview.spreadsheetId,
    spreadsheetTitle: preview.spreadsheetTitle,
    startWeek: readOptionalText(parsed.startWeek),
    endWeek: readOptionalText(parsed.endWeek),
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

function setFiniteAmount(index, mapping, amount) {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    index.set(cashflowMappingKey(mapping), amount);
  }
}

function buildSnapshotAmountIndex(snapshot) {
  const index = new Map();

  const months = Array.isArray(snapshot?.readModel?.months) ? snapshot.readModel.months : [];
  for (const month of months) {
    const yearMonth = readOptionalText(month?.yearMonth);
    if (!yearMonth) continue;
    for (const mode of ['projection', 'actual']) {
      const weeks = Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : [];
      for (const week of weeks) {
        const weekNo = Number(week?.weekNo);
        if (!Number.isFinite(weekNo)) continue;
        const amounts = week?.amounts && typeof week.amounts === 'object' ? week.amounts : {};
        for (const [lineId, amount] of Object.entries(amounts)) {
          setFiniteAmount(index, { mode, yearMonth, weekNo, lineId }, amount);
        }
      }
    }
  }

  for (const mode of ['projection', 'actual']) {
    const rows = Array.isArray(snapshot?.[mode]) ? snapshot[mode] : [];
    for (const row of rows) {
      const yearMonth = readOptionalText(row?.yearMonth);
      const weekNo = Number(row?.weekNo);
      const lineId = readOptionalText(row?.cashflowLine);
      if (!yearMonth || !Number.isFinite(weekNo) || !lineId) continue;
      setFiniteAmount(index, { mode, yearMonth, weekNo, lineId }, row?.amount);
    }
  }

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
    source: 'java_read_model',
  }));
}

function buildApplyLines(template, matrix = [], weekRange) {
  return template.mappingCandidates
    .filter((mapping) => isInWeekRange(mapping, weekRange))
    .map((mapping) => ({
      mode: mapping.mode,
      yearMonth: mapping.yearMonth,
      weekNo: mapping.weekNo,
      cashflowLine: mapping.lineId,
      amount: parseCashflowSheetAmount(readSheetCell(matrix, mapping)),
      sourceCell: mapping.a1,
      sourceLabel: mapping.label || mapping.canonicalLabel || mapping.lineId,
    }));
}

function createSheetPreviewLoader({ googleSheetsService, cacheTtlMs = DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS } = {}) {
  const cache = new Map();
  const inFlight = new Map();

  function cacheKey({ value, sheetName }) {
    return JSON.stringify({
      value: readOptionalText(value),
      sheetName: readOptionalText(sheetName),
      rangeA1: CASHFLOW_SHEET_LAB_READ_RANGE,
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
      const first = await requestPreview(params.sheetName);
      if (params.sheetName || isCashflowUsageLinkedSheetName(first.selectedSheetName)) {
        return first;
      }
      const linkedSheet = findCashflowUsageLinkedSheet(first.availableSheets);
      if (!linkedSheet) return first;
      return requestPreview(linkedSheet.title);
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
  javaWeeklyClient,
  bffProjectId = '',
  workspaceEmailDomain = 'mysc.co.kr',
  sheetPreviewCacheTtlMs = DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS,
} = {}) {
  const loadSheetPreview = createSheetPreviewLoader({
    googleSheetsService,
    cacheTtlMs: sheetPreviewCacheTtlMs,
  });

  app.get('/api/v1/projects/:projectId/cashflow-sheet-lab/config', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, javaWeeklyClient?.workspaceEmailDomain || workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const project = await readProjectDocument(db, tenantId, projectId);
    res.status(200).json(buildConfigResponse(projectId, readCashflowSheetLabConfig(project)));
  }));

  app.put('/api/v1/projects/:projectId/cashflow-sheet-lab/config', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, javaWeeklyClient?.workspaceEmailDomain || workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabConfigSchema, req.body, 'Invalid cashflow sheet lab config payload');
    normalizeWeekRange(parsed);

    await readProjectDocument(db, tenantId, projectId);

    try {
      const preview = await loadSheetPreview({
        value: parsed.value,
        sheetName: parsed.sheetName,
      });
      assertCashflowUsageLinkedSheet(preview);
      const config = await saveCashflowSheetLabConfig({
        db,
        tenantId,
        projectId,
        parsed,
        preview,
        context: req.context,
      });
      res.status(200).json(buildConfigResponse(projectId, config));
    } catch (error) {
      throw normalizeRouteError(error);
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/preview', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, javaWeeklyClient?.workspaceEmailDomain || workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabPreviewSchema, req.body, 'Invalid cashflow sheet lab preview payload');
    const project = await readProjectDocument(db, tenantId, projectId);
    const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
    const weekRange = normalizeWeekRange(source);

    try {
      const preview = await loadSheetPreview({
        value: source.value,
        sheetName: source.sheetName,
      });
      assertCashflowUsageLinkedSheet(preview);
      const template = analyzeCashflowSheetTemplate(preview.matrix);

      let cashflowSnapshot = null;
      let cashflowSnapshotStatus = parsed.includeValues === false ? 'pending' : 'unavailable';
      let cashflowSnapshotError = null;

      if (parsed.includeValues !== false && javaWeeklyClient?.getCashflowSnapshot) {
        try {
          cashflowSnapshot = await javaWeeklyClient.getCashflowSnapshot({
            context: buildJavaReadContext(req.context, javaWeeklyClient.workspaceEmailDomain || workspaceEmailDomain),
            projectId,
          });
          cashflowSnapshotStatus = 'ready';
        } catch (error) {
          if (!shouldReturnSnapshotUnavailable(error)) throw error;
          cashflowSnapshotError = {
            code: readOptionalText(error.code) || 'jvm_weekly_api_unavailable',
            message: readOptionalText(error.message) || 'Java cashflow read model is unavailable.',
          };
        }
      }

      const previewValues = buildPreviewValues(template, cashflowSnapshot, preview.matrix)
        .filter((value) => isInWeekRange(value, weekRange));

      res.status(200).json({
        projectId,
        spreadsheetId: preview.spreadsheetId,
        spreadsheetTitle: preview.spreadsheetTitle,
        selectedSheetName: preview.selectedSheetName,
        availableSheets: preview.availableSheets,
        matrix: preview.matrix,
        accessPolicy: {
          googleAuth: 'service_account',
          googleScope: 'spreadsheets.readonly',
          sheetPermission: 'shared_with_mysc_system_account',
          layoutSource: 'google_sheet_formatted_values',
          valueSource: 'java_cashflow_read_model',
          actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read',
          sheetReadRange: CASHFLOW_SHEET_LAB_READ_RANGE,
          sheetPreviewCache: preview.cacheStatus,
          sheetNamePolicy: 'cashflow_usage_linked_only',
          sheetConfigSource: source.source,
          bffFirestoreProjectId: readOptionalText(bffProjectId) || null,
          javaFirestoreProjectId: readOptionalText(javaWeeklyClient?.firestoreProjectId) || null,
          applyEnvironmentAligned: Boolean(
            readOptionalText(bffProjectId)
            && readOptionalText(javaWeeklyClient?.firestoreProjectId)
            && readOptionalText(bffProjectId) === readOptionalText(javaWeeklyClient?.firestoreProjectId),
          ),
        },
        activeWeekRange: {
          startWeek: weekRange.startWeek,
          endWeek: weekRange.endWeek,
        },
        template,
        previewValues,
        cashflowSnapshotStatus,
        cashflowSnapshotError,
      });
    } catch (error) {
      throw normalizeRouteError(error);
    }
  }));

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/apply', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, javaWeeklyClient?.workspaceEmailDomain || workspaceEmailDomain);
    if (!javaWeeklyClient?.applyCashflowSheetLab) {
      throw createHttpError(503, 'Java cashflow sheet apply API is not configured.', 'jvm_weekly_api_unconfigured');
    }
    assertApplyEnvironmentAligned({
      bffProjectId,
      javaFirestoreProjectId: javaWeeklyClient.firestoreProjectId,
    });

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabApplySchema, req.body, 'Invalid cashflow sheet lab apply payload');
    const project = await readProjectDocument(db, tenantId, projectId);
    const source = resolvePreviewSource(parsed, readCashflowSheetLabConfig(project));
    const weekRange = normalizeWeekRange(source);

    try {
      const preview = await loadSheetPreview({
        value: source.value,
        sheetName: source.sheetName,
      });
      assertCashflowUsageLinkedSheet(preview);
      const template = analyzeCashflowSheetTemplate(preview.matrix);
      if (!template.supported) {
        throw createHttpError(
          400,
          '지원하지 않는 cashflow 시트 구조라 반영할 수 없습니다.',
          'cashflow_sheet_template_unsupported',
        );
      }
      const lines = buildApplyLines(template, preview.matrix, weekRange);
      if (lines.length === 0) {
        throw createHttpError(400, '반영할 cashflow 값이 없습니다.', 'cashflow_sheet_apply_empty');
      }
      const applyResult = await javaWeeklyClient.applyCashflowSheetLab({
        context: buildJavaReadContext(req.context, javaWeeklyClient.workspaceEmailDomain || workspaceEmailDomain),
        projectId,
        idempotencyKey: parsed.idempotencyKey || `cashflow-sheet-lab:${projectId}:${randomUUID()}`,
        sourceSheetKey: 'cashflow-sheet-lab',
        lines,
      });
      res.status(200).json({
        projectId,
        spreadsheetId: preview.spreadsheetId,
        spreadsheetTitle: preview.spreadsheetTitle,
        selectedSheetName: preview.selectedSheetName,
        activeWeekRange: {
          startWeek: weekRange.startWeek,
          endWeek: weekRange.endWeek,
        },
        appliedLineCount: lines.length,
        projectionLineCount: lines.filter((line) => line.mode === 'projection').length,
        actualLineCount: lines.filter((line) => line.mode === 'actual').length,
        javaResult: applyResult,
      });
    } catch (error) {
      throw normalizeRouteError(error);
    }
  }));
}
