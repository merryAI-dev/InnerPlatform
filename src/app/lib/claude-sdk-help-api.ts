import { PlatformApiClient } from '../platform/api-client';
import { readPlatformApiRuntimeConfig, toRequestActor, type ActorLike } from './platform-bff-client';

let _client: PlatformApiClient | null = null;
function getClient(): PlatformApiClient {
  if (!_client) {
    const config = readPlatformApiRuntimeConfig();
    _client = new PlatformApiClient({
      baseUrl: config.baseUrl,
      maxRetries: 1,
      retryDelayMs: 500,
      timeoutMs: 60_000,
    });
  }
  return _client;
}

interface BaseParams {
  tenantId: string;
  actor: ActorLike;
}

export interface ClaudeSdkHelpSourceFile {
  label: string;
  path: string;
  note: string;
}

export interface ClaudeSdkHelpMeta {
  title: string;
  description: string;
  sourceFiles: ClaudeSdkHelpSourceFile[];
  quickstartSteps: string[];
  starterQuestions: string[];
  model: string;
}

export interface ClaudeSdkHelpAskResponse {
  answer: string;
  model: string;
  provider: 'anthropic' | 'fallback';
  tokensUsed: number;
  warning?: string;
}

export async function getClaudeSdkHelpMeta(params: BaseParams): Promise<ClaudeSdkHelpMeta> {
  const res = await getClient().get<ClaudeSdkHelpMeta>('/api/v1/claude-sdk/help/meta', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
  });
  return res.data;
}

export async function askClaudeSdkHelp(params: BaseParams & {
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<ClaudeSdkHelpAskResponse> {
  const res = await getClient().post<ClaudeSdkHelpAskResponse>('/api/v1/claude-sdk/help/ask', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: {
      question: params.question,
      history: params.history || [],
    },
  });
  return res.data;
}
