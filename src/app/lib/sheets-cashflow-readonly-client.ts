import {
  toRequestActor,
  type ActorLike,
  type GoogleSheetPreviewSheet,
  type PlatformApiClientLike,
} from './platform-bff-client';
import { PlatformApiClient } from '../platform/api-client';
import { extractSpreadsheetId } from '../integrations/google-sheets/link';

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
    googleAuth: 'token_pass_through' | 'service_account';
    googleScope: 'spreadsheets.readonly';
    sheetPermission: 'viewer_access_from_google_token' | 'shared_with_mysc_system_account';
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

export interface CashflowSheetLabConfig {
  value: string;
  sheetName?: string;
  startWeek?: string;
  endWeek?: string;
  weekBasis?: 'sheet_range';
  totalBasis?: 'sheet_range';
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  updatedAt?: string;
  updatedBy?: {
    uid?: string;
    email?: string;
    role?: string;
  } | null;
}

export interface CashflowSheetLabConfigResult {
  projectId: string;
  configured: boolean;
  config: CashflowSheetLabConfig | null;
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
  verifiedLineCount?: number;
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

export interface CashflowSheetLabProjectionWritebackCell {
  mode: 'projection';
  lineId: string;
  label: string;
  canonicalLabel?: string;
  direction: 'IN' | 'OUT';
  yearMonth: string;
  weekNo: number;
  rowIndex: number;
  columnIndex: number;
  a1: string;
  sheetValue: string;
  sheetAmount: number;
  platformAmount: number;
  nextSheetValue: number;
  changed: boolean;
}

export interface CashflowSheetLabProjectionWritebackResult {
  projectId: string;
  durationMs?: number;
  spreadsheetId: string;
  spreadsheetTitle: string;
  selectedSheetName: string;
  activeWeekRange: {
    startWeek?: string;
    endWeek?: string;
    weekBasis?: 'sheet_range';
    totalBasis?: 'sheet_range';
  };
  accessPolicy: {
    googleAuth: 'token_pass_through_or_service_account';
    googleScope: 'spreadsheets';
    writePolicy: 'projection_only';
    conflictPolicy: 'baseline_hash_required_before_write';
    sheetNamePolicy: 'cashflow_usage_linked_only';
    valueSource: 'firebase_cashflow_weeks.projection';
  };
  template: {
    supported: boolean;
    mappingCount: number;
    projectionMappingCount: number;
    reasons: CashflowSheetLabTemplateResult['reasons'];
  };
  plan: {
    baselineHash: string;
    totalCellCount: number;
    changeCount: number;
    changedAmountTotal: number;
    hasChanges: boolean;
    changedCells: CashflowSheetLabProjectionWritebackCell[];
    omittedChangedCellCount: number;
    baseline: {
      cellCount: number;
      hashAlgorithm: 'sha256';
    };
  };
  cashflowSnapshotStatus: 'ready';
  job?: {
    id: string;
    status: 'RUNNING' | 'DONE' | 'CONFLICT' | 'FAILED';
    updatedAt?: string;
  } | null;
  ok?: boolean;
  updatedCellCount?: number;
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

function googleAccessHeaders(token?: string): HeadersInit | undefined {
  const normalized = String(token || '').trim();
  return normalized ? { 'x-google-access-token': normalized } : undefined;
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
  googleAccessToken?: string;
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
      headers: googleAccessHeaders(params.googleAccessToken),
      timeoutMs: 25000,
      retries: 0,
    },
  );
  return response.data;
}

export async function applyCashflowSheetLabViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  idempotencyKey: string;
  googleAccessToken?: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabApplyResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.post<CashflowSheetLabApplyResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/apply`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        idempotencyKey: params.idempotencyKey,
      },
      idempotencyKey: params.idempotencyKey,
      headers: googleAccessHeaders(params.googleAccessToken),
      timeoutMs: 30000,
      retries: 0,
    },
  );
  return response.data;
}

export async function previewCashflowProjectionWritebackViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value?: string;
  sheetName?: string;
  startWeek?: string;
  endWeek?: string;
  googleAccessToken?: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabProjectionWritebackResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.post<CashflowSheetLabProjectionWritebackResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/writeback/preview`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        ...(params.value ? { value: params.value } : {}),
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
        ...(params.startWeek ? { startWeek: params.startWeek } : {}),
        ...(params.endWeek ? { endWeek: params.endWeek } : {}),
      },
      headers: googleAccessHeaders(params.googleAccessToken),
      timeoutMs: 25000,
      retries: 0,
    },
  );
  return response.data;
}

export async function applyCashflowProjectionWritebackViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  baselineHash?: string;
  conflictResolution?: 'abort' | 'overwrite';
  idempotencyKey: string;
  googleAccessToken?: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabProjectionWritebackResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.post<CashflowSheetLabProjectionWritebackResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-sheet-lab/writeback/apply`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        baselineHash: params.baselineHash,
        conflictResolution: params.conflictResolution || 'abort',
        idempotencyKey: params.idempotencyKey,
      },
      idempotencyKey: params.idempotencyKey,
      headers: googleAccessHeaders(params.googleAccessToken),
      timeoutMs: 30000,
      retries: 0,
    },
  );
  return response.data;
}

export async function getCashflowSheetLabConfigViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabConfigResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.get<CashflowSheetLabConfigResult>(
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

export async function saveCashflowSheetLabConfigViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value: string;
  sheetName?: string;
  startWeek?: string;
  endWeek?: string;
  googleAccessToken?: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowSheetLabConfigResult> {
  const apiClient = params.client || createSameOriginBffClient();
  const response = await apiClient.request<CashflowSheetLabConfigResult>(
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
      headers: googleAccessHeaders(params.googleAccessToken),
      timeoutMs: 25000,
      retries: 0,
    },
  );
  return response.data;
}
