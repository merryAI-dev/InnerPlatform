import { featureFlags, parseFeatureFlag } from '../config/feature-flags';
import type { TransactionState } from '../data/types';
import { PlatformApiClient } from '../platform/api-client';
import type { RequestActor } from '../platform/request-context';

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

export interface UpsertLedgerPayload {
  id: string;
  projectId: string;
  name: string;
  expectedVersion?: number;
  [key: string]: unknown;
}

export interface UpsertTransactionPayload {
  id: string;
  projectId: string;
  ledgerId: string;
  counterparty: string;
  expectedVersion?: number;
  [key: string]: unknown;
}

export interface CreateCommentPayload {
  id?: string;
  content: string;
  authorName?: string;
  [key: string]: unknown;
}

export interface CreateEvidencePayload {
  id?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string;
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  [key: string]: unknown;
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

export function isPlatformApiEnabled(): boolean {
  return featureFlags.platformApiEnabled;
}
