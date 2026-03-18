import type { GuideDocument, GuideQA, GuideMessage } from '../data/types';
import { PlatformApiClient } from '../platform/api-client';
import type { RequestActor } from '../platform/request-context';
import { readPlatformApiRuntimeConfig, toRequestActor, type ActorLike } from './platform-bff-client';

// Separate client with longer timeout for Claude API calls
let _guideClient: PlatformApiClient | null = null;
function getClient(): PlatformApiClient {
  if (!_guideClient) {
    const config = readPlatformApiRuntimeConfig();
    _guideClient = new PlatformApiClient({
      baseUrl: config.baseUrl,
      maxRetries: 1,
      retryDelayMs: 500,
      timeoutMs: 60_000, // 60s for Claude API calls
    });
  }
  return _guideClient;
}

interface BaseParams { tenantId: string; actor: ActorLike }

// ── Upload ──

export async function uploadGuide(params: BaseParams & {
  title: string;
  content: string;
  sourceType: 'pdf' | 'text' | 'markdown';
  sourceFileName?: string;
}): Promise<{ id: string; charCount: number; status: string }> {
  const res = await getClient().post<{ id: string; charCount: number; status: string }>('/api/v1/guide/upload', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: {
      title: params.title,
      content: params.content,
      sourceType: params.sourceType,
      sourceFileName: params.sourceFileName,
    },
  });
  return res.data;
}

// ── Calibrate (multi-turn) ──

export interface CalibrateResponse {
  answer: string;
  turnCount: number;
  maxTurns: number;
  guideId: string;
}

export async function calibrateGuide(params: BaseParams & {
  guideId?: string;
  message: string;
}): Promise<CalibrateResponse> {
  const res = await getClient().post<CalibrateResponse>('/api/v1/guide/calibrate', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: { guideId: params.guideId, message: params.message },
  });
  return res.data;
}

// ── Finalize ──

export async function finalizeGuide(params: BaseParams & {
  guideId?: string;
}): Promise<{ id: string; status: string; hasSummary: boolean }> {
  const res = await getClient().post<{ id: string; status: string; hasSummary: boolean }>('/api/v1/guide/finalize', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: { guideId: params.guideId },
  });
  return res.data;
}

// ── Current guide metadata ──

export interface GuideMetadata {
  id: string;
  title: string;
  status: string;
  sourceType: string;
  sourceFileName?: string;
  charCount: number;
  calibrationTurns: number;
  hasCalibrationSummary: boolean;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

export async function getCurrentGuide(params: BaseParams): Promise<{ guide: GuideMetadata | null }> {
  const res = await getClient().get<{ guide: GuideMetadata | null }>('/api/v1/guide/current', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
  });
  return res.data;
}

// ── Ask Q&A ──

export interface AskResponse {
  id: string;
  answer: string;
  tokensUsed: number;
  guideId: string;
  guideTitle: string;
}

export async function askGuide(params: BaseParams & {
  question: string;
  guideId?: string;
}): Promise<AskResponse> {
  const res = await getClient().post<AskResponse>('/api/v1/guide/ask', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: { question: params.question, guideId: params.guideId },
  });
  return res.data;
}

// ── Q&A History ──

export async function listGuideQA(params: BaseParams & {
  limit?: number;
}): Promise<{ items: GuideQA[]; count: number }> {
  const path = params.limit ? `/api/v1/guide/qa?limit=${params.limit}` : '/api/v1/guide/qa';
  const res = await getClient().get<{ items: GuideQA[]; count: number }>(path, {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
  });
  return res.data;
}
