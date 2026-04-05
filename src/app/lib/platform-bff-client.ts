import { featureFlags, parseFeatureFlag } from '../config/feature-flags';
import type {
  ProjectSheetSourceSnapshot,
  ProjectSheetSourceType,
  ProjectRequestContractAnalysis,
  TransactionState,
} from '../data/types';
import { PlatformApiClient } from '../platform/api-client';
import type { RequestActor } from '../platform/request-context';
import type { MonthMondayWeek } from '../platform/cashflow-weeks';
import {
  deserializeImportRowsFromKernel,
  serializeImportRowsForKernel,
  type SettlementFlowSnapshot,
  type SettlementKernelActualSyncResponse,
  type SettlementKernelDeriveResponse,
  type SettlementKernelFlowSnapshotResponse,
} from '../platform/settlement-kernel-contract';
import type { ImportRow } from '../platform/settlement-csv';
import type { SettlementDerivationContext, SettlementDerivationOptions } from '../platform/settlement-row-derivation';
import type { SettlementActualSyncWeekPayload } from '../platform/settlement-sheet-sync';

export interface PlatformApiRuntimeConfig {
  enabled: boolean;
  baseUrl: string;
}

export interface ActorLike {
  uid: string;
  email?: string;
  role?: string;
  idToken?: string;
  googleAccessToken?: string;
}

export interface UpsertProjectPayload {
  id: string;
  name: string;
  expectedVersion?: number;
  [key: string]: unknown;
}

export interface TrashProjectPayload {
  expectedVersion: number;
  reason?: string;
}

export interface RestoreProjectPayload {
  expectedVersion: number;
}

export interface UpsertLedgerPayload {
  id: string;
  projectId: string;
  name: string;
  expectedVersion?: number;
}

export interface UpsertTransactionPayload {
  id: string;
  projectId: string;
  ledgerId: string;
  counterparty: string;
  expectedVersion?: number;
}

export interface CreateCommentPayload {
  id?: string;
  content: string;
  authorName?: string;
}

export interface CreateEvidencePayload {
  id?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string;
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

export interface ProjectRequestContractUploadPayload {
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export interface ProvisionProjectEvidenceDriveRootResult {
  projectId: string;
  folderId: string;
  folderName: string;
  webViewLink: string | null;
  sharedDriveId: string | null;
  version: number;
  updatedAt: string;
}

export interface LinkProjectEvidenceDriveRootResult extends ProvisionProjectEvidenceDriveRootResult {}

export interface GoogleSheetPreviewSheet {
  sheetId: number;
  title: string;
  index: number;
}

export interface GoogleSheetImportPreviewResult {
  spreadsheetId: string;
  spreadsheetTitle: string;
  selectedSheetName: string;
  availableSheets: GoogleSheetPreviewSheet[];
  matrix: string[][];
}

export interface GoogleSheetMigrationAnalysisSuggestion {
  sourceHeader: string;
  platformField: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface GoogleSheetMigrationAnalysisResult {
  provider: 'anthropic' | 'heuristic';
  model: string;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  likelyTarget: string;
  usageTips: string[];
  warnings: string[];
  nextActions: string[];
  suggestedMappings: GoogleSheetMigrationAnalysisSuggestion[];
  headerPreview?: string[];
}

export interface ProjectSheetSourceUploadPayload {
  sourceType: ProjectSheetSourceType;
  sheetName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
  rowCount: number;
  columnCount: number;
  matchedColumns?: string[];
  unmatchedColumns?: string[];
  previewMatrix?: string[][];
  applyTarget?: string;
}

export interface ProjectRequestContractAnalysisResult extends ProjectRequestContractAnalysis {}

export interface ProjectRequestRegistrationNotificationResult {
  ok: boolean;
  enabled: boolean;
  delivered: boolean;
  requestId: string;
  projectId: string | null;
  reason?: string;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSuggestedMappings(value: unknown): GoogleSheetMigrationAnalysisSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const sourceHeader = typeof item.sourceHeader === 'string' ? item.sourceHeader.trim() : '';
      const platformField = typeof item.platformField === 'string' ? item.platformField.trim() : '';
      const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
      const confidence = item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low'
        ? item.confidence
        : 'medium';
      if (!sourceHeader || !platformField || !reason) return null;
      return {
        sourceHeader,
        platformField,
        confidence,
        reason,
      } satisfies GoogleSheetMigrationAnalysisSuggestion;
    })
    .filter((item): item is GoogleSheetMigrationAnalysisSuggestion => Boolean(item));
}

function normalizeAiConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function normalizeProjectRequestTextSuggestion(value: unknown) {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    value: typeof raw.value === 'string' ? raw.value.trim() : '',
    confidence: normalizeAiConfidence(raw.confidence),
    evidence: typeof raw.evidence === 'string' ? raw.evidence.trim() : '',
  };
}

function normalizeProjectRequestNumberSuggestion(value: unknown) {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    value: typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : null,
    confidence: normalizeAiConfidence(raw.confidence),
    evidence: typeof raw.evidence === 'string' ? raw.evidence.trim() : '',
  };
}

export function normalizeGoogleSheetMigrationAnalysisResult(
  value: unknown,
): GoogleSheetMigrationAnalysisResult {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    provider: raw.provider === 'anthropic' ? 'anthropic' : 'heuristic',
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'unavailable',
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : 'AI 분석 결과를 확인할 수 없어 기본 가이드를 표시합니다.',
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : 'medium',
    likelyTarget: typeof raw.likelyTarget === 'string' && raw.likelyTarget.trim() ? raw.likelyTarget.trim() : 'unknown',
    usageTips: normalizeStringArray(raw.usageTips),
    warnings: normalizeStringArray(raw.warnings),
    nextActions: normalizeStringArray(raw.nextActions),
    suggestedMappings: normalizeSuggestedMappings(raw.suggestedMappings),
    headerPreview: normalizeStringArray(raw.headerPreview),
  };
}

export function normalizeProjectRequestContractAnalysisResult(
  value: unknown,
): ProjectRequestContractAnalysisResult {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields as Record<string, unknown> : {};
  return {
    provider: raw.provider === 'anthropic' ? 'anthropic' : 'heuristic',
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'unavailable',
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : '계약서 초안을 확인할 수 없어 직접 입력이 필요합니다.',
    warnings: normalizeStringArray(raw.warnings),
    nextActions: normalizeStringArray(raw.nextActions),
    extractedAt: typeof raw.extractedAt === 'string' && raw.extractedAt.trim()
      ? raw.extractedAt.trim()
      : new Date().toISOString(),
    fields: {
      officialContractName: normalizeProjectRequestTextSuggestion(fields.officialContractName),
      suggestedProjectName: normalizeProjectRequestTextSuggestion(fields.suggestedProjectName),
      clientOrg: normalizeProjectRequestTextSuggestion(fields.clientOrg),
      projectPurpose: normalizeProjectRequestTextSuggestion(fields.projectPurpose),
      description: normalizeProjectRequestTextSuggestion(fields.description),
      contractStart: normalizeProjectRequestTextSuggestion(fields.contractStart),
      contractEnd: normalizeProjectRequestTextSuggestion(fields.contractEnd),
      contractAmount: normalizeProjectRequestNumberSuggestion(fields.contractAmount),
      salesVatAmount: normalizeProjectRequestNumberSuggestion(fields.salesVatAmount),
    },
  };
}

export interface ProvisionTransactionEvidenceDriveResult {
  transactionId: string;
  projectId: string;
  projectFolderId: string;
  projectFolderName: string;
  folderId: string;
  folderName: string;
  webViewLink: string | null;
  sharedDriveId: string | null;
  syncStatus: 'LINKED';
  version: number;
  updatedAt: string;
}

export interface SyncTransactionEvidenceDriveResult {
  transactionId: string;
  projectId: string;
  folderId: string;
  folderName: string;
  webViewLink: string | null;
  sharedDriveId: string | null;
  evidenceCount: number;
  evidenceCompletedDesc: string | null;
  evidenceCompletedManualDesc?: string | null;
  evidenceAutoListedDesc: string | null;
  evidencePendingDesc: string | null;
  supportPendingDocs: string | null;
  evidenceMissing: string[];
  evidenceStatus: 'MISSING' | 'PARTIAL' | 'COMPLETE';
  lastSyncedAt: string;
  version: number;
  updatedAt: string;
}

export interface UploadTransactionEvidenceDrivePayload {
  fileName: string;
  originalFileName?: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
  category?: string;
}

export interface UploadTransactionEvidenceDriveResult extends SyncTransactionEvidenceDriveResult {
  driveFileId: string;
  fileName: string;
  originalFileName?: string;
  webViewLink: string | null;
  category: string;
  parserCategory: string;
  parserConfidence: number;
}

export interface OverrideTransactionEvidenceDriveCategoriesPayload {
  items: Array<{
    driveFileId: string;
    category: string;
  }>;
}

export interface PlatformApiClientLike {
  get<T>(path: string, options: {
    tenantId: string;
    actor: RequestActor;
    body?: unknown;
    headers?: HeadersInit;
    idempotencyKey?: string;
    requestId?: string;
    retries?: number;
    timeoutMs?: number;
  }): Promise<{ data: T }>;
  post<T>(path: string, options: {
    tenantId: string;
    actor: RequestActor;
    body?: unknown;
    headers?: HeadersInit;
    idempotencyKey?: string;
    requestId?: string;
    retries?: number;
    timeoutMs?: number;
  }): Promise<{ data: T }>;
  request<T>(path: string, options: {
    method?: string;
    tenantId: string;
    actor: RequestActor;
    body?: unknown;
    headers?: HeadersInit;
    idempotencyKey?: string;
    requestId?: string;
    retries?: number;
    timeoutMs?: number;
  }): Promise<{ data: T }>;
}

const DEFAULT_BFF_BASE_URL = 'http://127.0.0.1:8787';

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_BFF_BASE_URL;
  return value.trim().replace(/\/$/, '');
}

export function readPlatformApiRuntimeConfig(
  env: Record<string, unknown> = import.meta.env,
): PlatformApiRuntimeConfig {
  return {
    enabled: parseFeatureFlag(env.VITE_PLATFORM_API_ENABLED, false),
    baseUrl: normalizeBaseUrl(env.VITE_PLATFORM_API_BASE_URL),
  };
}

export function toRequestActor(actor: ActorLike): RequestActor {
  const mapped: RequestActor = {
    id: actor.uid,
    email: actor.email,
    role: actor.role,
  };
  if (actor.idToken) {
    mapped.idToken = actor.idToken;
  }
  return mapped;
}

export function createPlatformApiClient(
  env: Record<string, unknown> = import.meta.env,
): PlatformApiClient {
  const config = readPlatformApiRuntimeConfig(env);
  return new PlatformApiClient({
    baseUrl: config.baseUrl,
    maxRetries: 2,
    retryDelayMs: 200,
    timeoutMs: 4000,
  });
}

function resolveClient(client?: PlatformApiClientLike): PlatformApiClientLike {
  return client || createPlatformApiClient();
}

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value);
}

export async function upsertProjectViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  project: UpsertProjectPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string }>('/api/v1/projects', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: params.project,
  });

  return response.data;
}

export async function trashProjectViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: TrashProjectPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string; trashedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string; trashedAt: string }>(
    `/api/v1/projects/${params.projectId}/trash`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
    },
  );

  return response.data;
}

export async function restoreProjectViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: RestoreProjectPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string }>(
    `/api/v1/projects/${params.projectId}/restore`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
    },
  );

  return response.data;
}

export async function upsertLedgerViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  ledger: UpsertLedgerPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string }>('/api/v1/ledgers', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: params.ledger,
  });
  return response.data;
}

export async function upsertTransactionViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transaction: UpsertTransactionPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string; state: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string; state: string }>('/api/v1/transactions', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: params.transaction,
  });
  return response.data;
}

export async function changeTransactionStateViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  newState: TransactionState;
  expectedVersion: number;
  reason?: string;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; state: string; rejectedReason: string | null; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<{ id: string; state: string; rejectedReason: string | null; version: number; updatedAt: string }>(
    `/api/v1/transactions/${params.transactionId}/state`,
    {
      method: 'PATCH',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        newState: params.newState,
        expectedVersion: params.expectedVersion,
        reason: params.reason,
      },
    },
  );

  return response.data;
}

export async function addCommentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  comment: CreateCommentPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; transactionId: string; version: number; createdAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; transactionId: string; version: number; createdAt: string }>(
    `/api/v1/transactions/${params.transactionId}/comments`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.comment,
    },
  );
  return response.data;
}

export async function addEvidenceViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  evidence: CreateEvidencePayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; transactionId: string; version: number; uploadedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; transactionId: string; version: number; uploadedAt: string }>(
    `/api/v1/transactions/${params.transactionId}/evidences`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.evidence,
    },
  );
  return response.data;
}

export async function provisionProjectEvidenceDriveRootViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<ProvisionProjectEvidenceDriveRootResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProvisionProjectEvidenceDriveRootResult>(
    `/api/v1/projects/${params.projectId}/evidence-drive/root/provision`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
    },
  );
  return response.data;
}

export async function previewGoogleSheetImportViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value: string;
  sheetName?: string;
  client?: PlatformApiClientLike;
}): Promise<GoogleSheetImportPreviewResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<GoogleSheetImportPreviewResult>(
    `/api/v1/projects/${params.projectId}/google-sheet-import/preview`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      headers: params.actor.googleAccessToken
        ? { 'x-google-access-token': params.actor.googleAccessToken }
        : undefined,
      body: {
        value: params.value,
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
      },
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function analyzeGoogleSheetImportViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  spreadsheetTitle?: string;
  selectedSheetName: string;
  matrix: string[][];
  client?: PlatformApiClientLike;
}): Promise<GoogleSheetMigrationAnalysisResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<GoogleSheetMigrationAnalysisResult>(
    `/api/v1/projects/${params.projectId}/google-sheet-import/analyze`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        ...(params.spreadsheetTitle ? { spreadsheetTitle: params.spreadsheetTitle } : {}),
        selectedSheetName: params.selectedSheetName,
        matrix: params.matrix,
      },
      timeoutMs: 25000,
    },
  );
  return normalizeGoogleSheetMigrationAnalysisResult(response.data);
}

export async function deriveSettlementRowsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  rows: ImportRow[];
  context: SettlementDerivationContext;
  options: SettlementDerivationOptions;
  client?: PlatformApiClientLike;
}): Promise<ImportRow[]> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<SettlementKernelDeriveResponse>(
    `/api/v1/projects/${params.projectId}/settlement/derive`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        rows: serializeImportRowsForKernel(params.rows),
        context: params.context,
        options: params.options,
      },
      timeoutMs: 15000,
      retries: 0,
    },
  );
  return deserializeImportRowsFromKernel(response.data.rows);
}

export async function previewSettlementActualSyncViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  rows: ImportRow[];
  yearWeeks: MonthMondayWeek[];
  persistedRows?: ImportRow[] | null;
  client?: PlatformApiClientLike;
}): Promise<SettlementActualSyncWeekPayload[]> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<SettlementKernelActualSyncResponse>(
    `/api/v1/projects/${params.projectId}/settlement/actual-sync-preview`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        rows: serializeImportRowsForKernel(params.rows),
        yearWeeks: params.yearWeeks,
        ...(params.persistedRows ? { persistedRows: serializeImportRowsForKernel(params.persistedRows) } : {}),
      },
      timeoutMs: 15000,
      retries: 0,
    },
  );
  return response.data.weeks;
}

export async function previewSettlementFlowSnapshotsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  rows: ImportRow[];
  client?: PlatformApiClientLike;
}): Promise<SettlementFlowSnapshot[]> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<SettlementKernelFlowSnapshotResponse>(
    `/api/v1/projects/${params.projectId}/settlement/flow-snapshot-preview`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        rows: serializeImportRowsForKernel(params.rows),
      },
      timeoutMs: 15000,
      retries: 0,
    },
  );
  return response.data.snapshots;
}

export async function uploadProjectSheetSourceViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  upload: ProjectSheetSourceUploadPayload;
  client?: PlatformApiClientLike;
}): Promise<ProjectSheetSourceSnapshot> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectSheetSourceSnapshot>(
    `/api/v1/projects/${params.projectId}/sheet-sources/upload`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.upload,
      timeoutMs: 45000,
    },
  );
  return response.data;
}

export async function analyzeProjectRequestContractViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  fileName: string;
  documentText?: string;
  client?: PlatformApiClientLike;
}): Promise<ProjectRequestContractAnalysisResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectRequestContractAnalysisResult>(
    '/api/v1/project-requests/contract/analyze',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        fileName: params.fileName,
        ...(params.documentText ? { documentText: params.documentText } : {}),
      },
      timeoutMs: 45000,
    },
  );
  return normalizeProjectRequestContractAnalysisResult(response.data);
}

export async function uploadProjectRequestContractViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  upload: ProjectRequestContractUploadPayload;
  client?: PlatformApiClientLike;
}) {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{
    path: string;
    name: string;
    downloadURL: string;
    size: number;
    contentType: string;
    uploadedAt: string;
  }>(
    '/api/v1/project-requests/contract/upload',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.upload,
      timeoutMs: 45000,
    },
  );
  return response.data;
}

export async function processProjectRequestContractViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  file: File;
  client?: PlatformApiClientLike;
}): Promise<{
  contractDocument: {
    path: string;
    name: string;
    downloadURL: string;
    size: number;
    contentType: string;
    uploadedAt: string;
  };
  analysis: ProjectRequestContractAnalysisResult;
}> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<{
    contractDocument: {
      path: string;
      name: string;
      downloadURL: string;
      size: number;
      contentType: string;
      uploadedAt: string;
    };
    analysis: ProjectRequestContractAnalysisResult;
  }>(
    '/api/v1/project-requests/contract/process',
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeHeaderValue(params.file.name),
        'x-file-type': params.file.type || 'application/pdf',
        'x-file-size': String(params.file.size || 0),
      },
      body: params.file,
      timeoutMs: 45000,
      retries: 0,
    },
  );
  return {
    contractDocument: response.data.contractDocument,
    analysis: normalizeProjectRequestContractAnalysisResult(response.data.analysis),
  };
}

export async function notifyProjectRequestRegistrationViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectRequestId: string;
  client?: PlatformApiClientLike;
}): Promise<ProjectRequestRegistrationNotificationResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectRequestRegistrationNotificationResult>(
    `/api/v1/project-requests/${encodeURIComponent(params.projectRequestId)}/notify-registration`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {},
      idempotencyKey: `project-request-registration-notify:${params.projectRequestId}`,
      timeoutMs: 10000,
      retries: 0,
    },
  );
  return response.data;
}

export async function linkProjectEvidenceDriveRootViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value: string;
  client?: PlatformApiClientLike;
}): Promise<LinkProjectEvidenceDriveRootResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<LinkProjectEvidenceDriveRootResult>(
    `/api/v1/projects/${params.projectId}/evidence-drive/root/link`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: { value: params.value },
    },
  );
  return response.data;
}

export async function provisionTransactionEvidenceDriveViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  client?: PlatformApiClientLike;
}): Promise<ProvisionTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<ProvisionTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/provision`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 15000,
    },
  );
  return response.data;
}

export async function syncTransactionEvidenceDriveViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  client?: PlatformApiClientLike;
}): Promise<SyncTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<SyncTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/sync`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function uploadTransactionEvidenceDriveViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  upload: UploadTransactionEvidenceDrivePayload;
  client?: PlatformApiClientLike;
}): Promise<UploadTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<UploadTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/upload`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.upload,
      retries: 0,
      timeoutMs: 30000,
    },
  );
  return response.data;
}

export async function overrideTransactionEvidenceDriveCategoriesViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  overrides: OverrideTransactionEvidenceDriveCategoriesPayload;
  client?: PlatformApiClientLike;
}): Promise<SyncTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<SyncTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/overrides`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.overrides,
      retries: 0,
      timeoutMs: 15000,
    },
  );
  return response.data;
}

export function isPlatformApiEnabled(): boolean {
  return featureFlags.platformApiEnabled;
}

// ─── Budget Suggestion ───────────────────────────────────────────────────────

export interface BudgetSuggestion {
  budgetCategory: string;
  budgetSubCategory: string;
  /** 'history' = 과거 거래 패턴 기반, 'codebook' = 코드북 키워드 매칭 */
  confidence: 'history' | 'codebook';
}

/**
 * 거래처 이름 기반 비목/세목 제안을 BFF에서 조회한다.
 * 히스토리가 없으면 null 반환.
 */
export async function fetchBudgetSuggestionViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  counterparty: string;
  client?: PlatformApiClientLike;
}): Promise<BudgetSuggestion | null> {
  if (!params.counterparty.trim() || !params.projectId.trim()) return null;
  const apiClient = resolveClient(params.client);
  const qs = new URLSearchParams({
    counterparty: params.counterparty.trim(),
    projectId: params.projectId.trim(),
  });
  const response = await apiClient.get<{ suggestion: BudgetSuggestion | null }>(
    `/api/v1/budget/suggest?${qs}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 3000,
    },
  );
  return response.data.suggestion ?? null;
}
