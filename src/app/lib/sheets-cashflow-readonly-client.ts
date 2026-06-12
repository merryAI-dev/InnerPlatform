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
  labelColumnIndex: number;
  a1: string;
  lineId: string;
  direction: 'IN' | 'OUT';
}

export interface CashflowSheetLabMappingCandidate {
  mode: 'projection' | 'actual';
  lineId: string;
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
  };
  template: CashflowSheetLabTemplateResult;
  previewValues: CashflowSheetLabPreviewValue[];
  cashflowSnapshotStatus: 'pending' | 'ready' | 'unavailable';
  cashflowSnapshotError?: { code: string; message: string } | null;
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
  value: string;
  sheetName?: string;
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
        value: params.value,
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
        ...(typeof params.includeValues === 'boolean' ? { includeValues: params.includeValues } : {}),
      },
      timeoutMs: 25000,
      retries: 0,
    },
  );
  return response.data;
}
