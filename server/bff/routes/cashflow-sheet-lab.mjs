import {
  asyncHandler,
  createHttpError,
  ensureDocumentExists,
  readOptionalText,
} from '../bff-utils.mjs';
import { GoogleSheetsServiceError } from '../google-sheets.mjs';
import { isWorkspaceUser } from '../java-weekly-client.mjs';
import { analyzeCashflowSheetTemplate } from '../cashflow-sheet-template.mjs';
import { cashflowSheetLabPreviewSchema, parseWithSchema } from '../schemas.mjs';

const CASHFLOW_SHEET_LAB_ROLES = ['workspace_user', 'pm', 'finance', 'admin'];

function normalizeRole(value) {
  const normalized = readOptionalText(value).toLowerCase();
  return normalized === 'viewer' ? 'pm' : normalized;
}

function assertCashflowSheetLabAccess(req, workspaceEmailDomain = 'mysc.co.kr') {
  const actorRole = normalizeRole(req.context?.actorRole);
  if (CASHFLOW_SHEET_LAB_ROLES.includes(actorRole)) return;
  if (isWorkspaceUser(req.context, workspaceEmailDomain)) return;
  throw createHttpError(403, `Role '${actorRole || 'unknown'}' is not allowed to preview cashflow sheets lab`, 'forbidden');
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

function readSnapshotAmountFromReadModel(snapshot, mapping) {
  const months = Array.isArray(snapshot?.readModel?.months) ? snapshot.readModel.months : [];
  const month = months.find((entry) => entry?.yearMonth === mapping.yearMonth);
  const modeModel = month?.[mapping.mode];
  const weeks = Array.isArray(modeModel?.weeks) ? modeModel.weeks : [];
  const week = weeks.find((entry) => Number(entry?.weekNo) === mapping.weekNo);
  const amount = week?.amounts?.[mapping.lineId];
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
}

function readSnapshotAmountFromFlatRows(snapshot, mapping) {
  const rows = Array.isArray(snapshot?.[mapping.mode]) ? snapshot[mapping.mode] : [];
  const row = rows.find((entry) => (
    entry?.yearMonth === mapping.yearMonth
    && Number(entry?.weekNo) === mapping.weekNo
    && entry?.cashflowLine === mapping.lineId
  ));
  return typeof row?.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null;
}

function readSnapshotAmountFromLegacyWeeks(snapshot, mapping) {
  const weeks = Array.isArray(snapshot?.weeks) ? snapshot.weeks : [];
  const week = weeks.find((entry) => entry?.yearMonth === mapping.yearMonth && Number(entry?.weekNo) === mapping.weekNo);
  const amount = week?.[mapping.mode]?.[mapping.lineId];
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
}

function buildPreviewValues(template, cashflowSnapshot) {
  return template.mappingCandidates.map((mapping) => ({
    ...mapping,
    amount: cashflowSnapshot
      ? readSnapshotAmountFromReadModel(cashflowSnapshot, mapping)
        ?? readSnapshotAmountFromFlatRows(cashflowSnapshot, mapping)
        ?? readSnapshotAmountFromLegacyWeeks(cashflowSnapshot, mapping)
      : null,
    source: 'java_read_model',
  }));
}

export function mountCashflowSheetLabRoutes(app, {
  db,
  googleSheetsService,
  javaWeeklyClient,
  workspaceEmailDomain = 'mysc.co.kr',
} = {}) {
  app.post('/api/v1/projects/:projectId/cashflow-sheet-lab/preview', asyncHandler(async (req, res) => {
    assertCashflowSheetLabAccess(req, javaWeeklyClient?.workspaceEmailDomain || workspaceEmailDomain);

    const { tenantId } = req.context;
    const { projectId } = req.params;
    const parsed = parseWithSchema(cashflowSheetLabPreviewSchema, req.body, 'Invalid cashflow sheet lab preview payload');

    if (db) {
      await ensureDocumentExists(db, `orgs/${tenantId}/projects/${projectId}`, `Project not found: ${projectId}`);
    }

    try {
      const preview = await googleSheetsService.previewSpreadsheet({
        value: parsed.value,
        sheetName: parsed.sheetName,
      });
      const template = analyzeCashflowSheetTemplate(preview.matrix);

      let cashflowSnapshot = null;
      let cashflowSnapshotStatus = 'unavailable';
      let cashflowSnapshotError = null;

      if (javaWeeklyClient?.getCashflowSnapshot) {
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
        },
        template,
        previewValues: buildPreviewValues(template, cashflowSnapshot),
        cashflowSnapshotStatus,
        cashflowSnapshot,
        cashflowSnapshotError,
      });
    } catch (error) {
      throw normalizeRouteError(error);
    }
  }));
}

export const CASHFLOW_SHEET_LAB_ALLOWED_ROLES = CASHFLOW_SHEET_LAB_ROLES;
