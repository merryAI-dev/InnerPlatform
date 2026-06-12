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
  source: 'java_read_model';
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
    valueSource: 'java_cashflow_read_model';
    actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read';
    sheetReadRange: string;
    sheetPreviewCache: 'hit' | 'miss' | 'in_flight_join';
    sheetNamePolicy: 'cashflow_usage_linked_only';
    sheetConfigSource?: 'request' | 'saved_config';
    bffFirestoreProjectId?: string | null;
    javaFirestoreProjectId?: string | null;
    applyEnvironmentAligned?: boolean;
  };
  activeWeekRange?: {
    startWeek?: string;
    endWeek?: string;
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
  activeWeekRange?: {
    startWeek?: string;
    endWeek?: string;
  };
  appliedLineCount: number;
  projectionLineCount: number;
  actualLineCount: number;
  javaResult: {
    ok: boolean;
    commandName: string;
    projectId: string;
    sourceSheetKey: string;
    savedProjectionLineCount: number;
    savedActualLineCount: number;
    auditId: string;
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

export async function applyCashflowSheetLabViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  idempotencyKey: string;
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
      timeoutMs: 25000,
      retries: 0,
    },
  );
  return response.data;
}
