import {
  asyncHandler,
  createHttpError,
  ensureDocumentExists,
  readOptionalText,
} from '../bff-utils.mjs';
import { GoogleSheetsServiceError } from '../google-sheets.mjs';
import { isWorkspaceUser } from '../java-weekly-client.mjs';
import { analyzeCashflowSheetTemplate, cashflowMappingKey } from '../cashflow-sheet-template.mjs';
import { cashflowSheetLabPreviewSchema, parseWithSchema } from '../schemas.mjs';

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

function buildPreviewValues(template, cashflowSnapshot, matrix = []) {
  const amountIndex = cashflowSnapshot ? buildSnapshotAmountIndex(cashflowSnapshot) : null;
  return template.mappingCandidates.map((mapping) => ({
    ...mapping,
    sheetValue: readSheetCell(matrix, mapping),
    amount: readIndexedSnapshotAmount(amountIndex, mapping),
    source: 'java_read_model',
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
  workspaceEmailDomain = 'mysc.co.kr',
  sheetPreviewCacheTtlMs = DEFAULT_SHEET_PREVIEW_CACHE_TTL_MS,
} = {}) {
  const loadSheetPreview = createSheetPreviewLoader({
    googleSheetsService,
    cacheTtlMs: sheetPreviewCacheTtlMs,
  });

  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/preview', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, javaWeeklyClient?.workspaceEmailDomain || workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabPreviewSchema, req.body, 'Invalid cashflow sheet lab preview payload');

    if (db) {
      await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);
    }

    try {
      const preview = await loadSheetPreview({
        value: parsed.value,
        sheetName: parsed.sheetName,
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
        },
        template,
        previewValues: buildPreviewValues(template, cashflowSnapshot, preview.matrix),
        cashflowSnapshotStatus,
        cashflowSnapshotError,
      });
    } catch (error) {
      throw normalizeRouteError(error);
    }
  }));
}
