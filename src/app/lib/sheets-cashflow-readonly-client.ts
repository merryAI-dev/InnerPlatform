import {
  toRequestActor,
  type ActorLike,
  type GoogleSheetPreviewSheet,
  type PlatformApiClientLike,
} from './platform-bff-client';
import { PlatformApiClient } from '../platform/api-client';
import { extractSpreadsheetId } from '../integrations/google-sheets/link';
import {
  cashflowMutationHeaders,
  type CashflowMutationLease,
} from './cashflow-edit-lease';

export interface CashflowSheetLabWeekColumn {
  raw: string;
  year: number;
  month: number;
  yearMonth: string;
  weekNo: number;
  rowIndex: number;
  columnIndex: number;
  a1: string;
}

export interface CashflowSheetLabLineRow {
  rowIndex: number;
  label: string;
  canonicalLabel?: string;
  labelColumnIndex: number;
  a1: string;
  lineId: string;
  direction: 'IN' | 'OUT';
}

export interface CashflowSheetLabMappingCandidate {
  mode: 'projection' | 'actual';
  lineId: string;
  label: string;
  canonicalLabel?: string;
  direction: 'IN' | 'OUT';
  yearMonth: string;
  weekNo: number;
  rowIndex: number;
  columnIndex: number;
  a1: string;
  source: 'sheet_layout';
}

export interface CashflowSheetLabPreviewValue extends Omit<CashflowSheetLabMappingCandidate, 'source'> {
  sheetValue: string;
  amount: number | null;
  source: 'firebase_cashflow_weeks';
}

export interface CashflowSheetLabTemplateSection {
  mode: 'projection' | 'actual';
  headerRowIndex: number;
  weekRowIndex: number;
  weekColumns: CashflowSheetLabWeekColumn[];
  lineRows: CashflowSheetLabLineRow[];
  derivedRows: Array<{
    rowIndex: number;
    label: string;
    labelColumnIndex: number;
    a1: string;
    kind: 'deposit_total' | 'withdrawal_total' | 'balance';
  }>;
  ignoredRows: Array<{
    rowIndex: number;
    label: string;
    labelColumnIndex: number;
    a1: string;
    reason: string;
  }>;
  mappings: CashflowSheetLabMappingCandidate[];
  missingLineIds: string[];
  duplicateLineIds: string[];
}

export interface CashflowSheetLabTemplateResult {
  supported: boolean;
  policyVersion: string;
  sectionOrder: ['projection', 'actual'];
  sections: CashflowSheetLabTemplateSection[];
  mappingCandidates: CashflowSheetLabMappingCandidate[];
  derivedRows: Array<CashflowSheetLabTemplateSection['derivedRows'][number] & { mode: 'projection' | 'actual' }>;
  ignoredRows: Array<CashflowSheetLabTemplateSection['ignoredRows'][number] & { mode: 'projection' | 'actual' }>;
  reasons: Array<{
    code: string;
    mode?: 'projection' | 'actual';
    lineIds?: string[];
    count?: number;
    message: string;
  }>;
  stats: {
    rowCount: number;
    maxColumnCount: number;
    sectionCount: number;
    mappingCount: number;
  };
}

export interface CashflowSheetLabPreviewResult {
  projectId: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  selectedSheetName: string;
  availableSheets: GoogleSheetPreviewSheet[];
  matrix: string[][];
  accessPolicy: {
    googleAuth: 'service_account';
    googleScope: 'spreadsheets.readonly';
    sheetPermission: 'shared_with_mysc_system_account';
    layoutSource: 'google_sheet_formatted_values';
    valueSource: 'firebase_cashflow_weeks';
    actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read';
    sheetReadRange: string;
    sheetPreviewCache: 'hit' | 'miss' | 'in_flight_join';
    sheetNamePolicy: 'cashflow_usage_linked_only';
    sheetConfigSource?: 'request' | 'saved_config';
    weekBasis?: 'sheet_range';
    totalBasis?: 'sheet_range';
  };
  activeWeekRange?: {
    startWeek?: string;
    endWeek?: string;
    weekBasis?: 'sheet_range';
    totalBasis?: 'sheet_range';
  };
  template: CashflowSheetLabTemplateResult;
  previewValues: CashflowSheetLabPreviewValue[];
  cashflowSnapshotStatus: 'pending' | 'ready' | 'unavailable';
  cashflowSnapshotError?: { code: string; message: string } | null;
}

export interface CashflowSheetLabApplyResult {
  projectId: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  selectedSheetName: string;
  availableSheets?: GoogleSheetPreviewSheet[];
  matrix?: string[][];
  accessPolicy?: CashflowSheetLabPreviewResult['accessPolicy'];
  template?: CashflowSheetLabTemplateResult;
  previewValues?: CashflowSheetLabPreviewValue[];
  cashflowSnapshotStatus?: CashflowSheetLabPreviewResult['cashflowSnapshotStatus'];
  cashflowSnapshotError?: CashflowSheetLabPreviewResult['cashflowSnapshotError'];
  activeWeekRange?: {
    startWeek?: string;
    endWeek?: string;
    weekBasis?: 'sheet_range';
    totalBasis?: 'sheet_range';
  };
  appliedLineCount: number;
  projectionLineCount: number;
  actualLineCount: number;
  skippedInvalidWeekCount?: number;
  skippedInvalidWeeks?: string[];
  skippedRiskLineCount?: number;
  verifiedLineCount?: number;
  lastAppliedAt?: string;
  runId?: string;
  stagedRunId?: string;
  lastAppliedBy?: {
    uid?: string;
    email?: string;
    role?: string;
  } | null;
  firebaseResult: {
    ok: boolean;
    commandName: string;
    projectId: string;
    sourceSheetKey: string;
    weekBasis?: 'sheet_range';
    totalBasis?: 'sheet_range';
    savedProjectionLineCount: number;
    savedActualLineCount: number;
    skippedInvalidWeekCount?: number;
    skippedInvalidWeeks?: string[];
    verifiedLineCount?: number;
    updatedWeeks: Array<{
      projectId: string;
      yearMonth: string;
      weekNo: number;
      mode: 'projection' | 'actual';
      updatedAt: string;
    }>;
  };
}

export interface CashflowSheetLabChangeCandidate {
  id?: string;
  projectId: string;
  runId: string;
  source: 'google_sheet' | 'portal';
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'applied' | 'superseded' | 'failed';
  mode: 'projection' | 'actual';
  yearMonth: string;
  weekNo: number;
  lineId: string;
  lineDirection: 'in' | 'out';
  beforeAmount: number | null;
  beforeHadValue: boolean;
  proposedAmount: number;
  proposedHadValue: boolean;
  sourceCell?: string;
  sourceLabel?: string;
  riskFlags?: string[];
  actorUid?: string;
  actorName?: string;
  actorEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashflowSheetLabMirrorCell {
  mode: 'projection' | 'actual';
  yearMonth: string;
  weekNo: number;
  lineId: string;
  direction: 'IN' | 'OUT';
  sourceCell: string;
  sourceLabel: string;
  state: 'VALUE' | 'EMPTY' | 'INVALID';
  amount?: number;
  rawValue?: string;
}

export interface CashflowSheetLabMirrorResult {
  schemaVersion?: number;
  projectId: string;
  status: 'EMPTY' | 'FRESH' | 'STALE' | 'ERROR';
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  selectedSheetName?: string;
  sourceRevision?: string;
  targetRevisionAtFetch?: string;
  capturedAt?: string;
  capturedBy?: { uid?: string; email?: string; role?: string };
  yearMonths?: string[];
  summary?: { cellCount: number; valueCount: number; emptyCount: number; invalidCount: number };
  cells?: CashflowSheetLabMirrorCell[];
  activeWeekRange?: CashflowSheetLabApplyResult['activeWeekRange'] & { activeWeeks?: unknown[] };
  lastRefreshAttemptAt?: string;
  lastRefreshError?: { code: string; message: string; statusCode?: number; at?: string } | null;
}

export interface CashflowSheetLabStageResult {
  ok: boolean;
  commandName: 'cashflowSheetLab.stage.firebase';
  projectId: string;
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  selectedSheetName?: string;
  activeWeekRange?: CashflowSheetLabApplyResult['activeWeekRange'];
  sourceRevision?: string;
  targetRevisionAtFetch?: string;
  runId: string;
  status?: 'READY' | 'BLOCKED';
  stagedLineCount: number;
  projectionLineCount: number;
  actualLineCount: number;
  riskLineCount: number;
  skippedInvalidWeekCount?: number;
  skippedInvalidWeeks?: string[];
  blockedMonths?: string[];
  candidates?: CashflowSheetLabChangeCandidate[];
  omittedCandidateCount?: number;
  lastStagedAt?: string;
  lastStagedBy?: {
    uid?: string;
    email?: string;
    role?: string;
  } | null;
}

export interface CashflowSheetLabShareAccountResult {
  projectId: string;
  configured?: boolean;
  config?: {
    value?: string;
    sheetName?: string;
    spreadsheetId?: string;
    spreadsheetTitle?: string;
    startWeek?: string;
    endWeek?: string;
    updatedAt?: string;
    lastAppliedAt?: string;
    lastAppliedBy?: {
      uid?: string;
      email?: string;
      role?: string;
    } | null;
    lastAppliedLineCount?: number;
    lastProjectionLineCount?: number;
    lastActualLineCount?: number;
  } | null;
  systemAccountEmail?: string;
  accessPolicy?: {
    googleAuth: 'service_account';
    serviceAccountEmail?: string;
    sheetPermission: 'shared_with_mysc_system_account';
  };
}

export const extractSpreadsheetIdFromSheetInput = extractSpreadsheetId;

function createSameOriginBffClient(): PlatformApiClient {
  return new PlatformApiClient({
    baseUrl: '',
    maxRetries: 1,
    retryDelayMs: 200,
    timeoutMs: 25000,
  });
}

export async function previewCashflowSheetLabViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value?: string;
  sheetName?: string;
  startWeek?: string;
  endWeek?: string;
  includeValues?: boolean;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabPreviewResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.post<CashflowSheetLabPreviewResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/preview`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        ...(params.value ? { value: params.value } : {}),
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
        ...(params.startWeek ? { startWeek: params.startWeek } : {}),
        ...(params.endWeek ? { endWeek: params.endWeek } : {}),
        ...(typeof params.includeValues === 'boolean' ? { includeValues: params.includeValues } : {}),
      },
      timeoutMs: 25000,
      retries: 0,
    },
  );
  return response.data;
}

export async function saveCashflowSheetLabConfigViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value: string;
  sheetName?: string;
  startWeek?: string;
  endWeek?: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabShareAccountResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.request<CashflowSheetLabShareAccountResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/config`,
    {
      method: 'PUT',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        value: params.value,
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
        ...(params.startWeek ? { startWeek: params.startWeek } : {}),
        ...(params.endWeek ? { endWeek: params.endWeek } : {}),
      },
      timeoutMs: 15000,
      retries: 0,
    },
  );
  return response.data;
}

export async function applyCashflowSheetLabViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value?: string;
  sheetName?: string;
  startWeek?: string;
  endWeek?: string;
  stageRunId?: string;
  applyRiskCandidates?: boolean;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  finalize?: boolean;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabApplyResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.post<CashflowSheetLabApplyResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/apply`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        ...(params.value ? { value: params.value } : {}),
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
        ...(params.startWeek ? { startWeek: params.startWeek } : {}),
        ...(params.endWeek ? { endWeek: params.endWeek } : {}),
        ...(params.stageRunId ? { stageRunId: params.stageRunId } : {}),
        ...(typeof params.applyRiskCandidates === 'boolean' ? { applyRiskCandidates: params.applyRiskCandidates } : {}),
        idempotencyKey: params.idempotencyKey,
      },
      idempotencyKey: params.idempotencyKey,
      headers: {
        ...cashflowMutationHeaders(params.lease),
        ...(params.finalize ? { 'x-edit-finalize': 'true' } : {}),
      },
      timeoutMs: 30000,
      retries: 0,
    },
  );
  return response.data;
}

export async function stageCashflowSheetLabViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  expectedMirrorRevision: string;
  idempotencyKey: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabStageResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.post<CashflowSheetLabStageResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/stage`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        expectedMirrorRevision: params.expectedMirrorRevision,
        idempotencyKey: params.idempotencyKey,
      },
      idempotencyKey: params.idempotencyKey,
      timeoutMs: 30000,
      retries: 0,
    },
  );
  return response.data;
}

export async function getCashflowSheetLabMirrorViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabMirrorResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.get<CashflowSheetLabMirrorResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/mirror`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      timeoutMs: 15000,
      retries: 0,
    },
  );
  return response.data;
}

export async function refreshCashflowSheetLabMirrorViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value?: string;
  sheetName?: string;
  startWeek?: string;
  endWeek?: string;
  idempotencyKey: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabMirrorResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.post<CashflowSheetLabMirrorResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/mirror/refresh`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        ...(params.value ? { value: params.value } : {}),
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
        ...(params.startWeek ? { startWeek: params.startWeek } : {}),
        ...(params.endWeek ? { endWeek: params.endWeek } : {}),
        idempotencyKey: params.idempotencyKey,
      },
      idempotencyKey: params.idempotencyKey,
      timeoutMs: 30000,
      retries: 0,
    },
  );
  return response.data;
}

export async function getCashflowSheetLabShareAccountViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabShareAccountResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.get<CashflowSheetLabShareAccountResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/config`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      timeoutMs: 15000,
      retries: 0,
    },
  );
  return response.data;
}
