import {
  createPlatformApiClient,
  toRequestActor,
  type ActorLike,
  type PlatformApiClientLike,
} from './platform-bff-client';

export interface RosterPushProjectRef {
  projectId: string;
  projectName: string;
}

export interface RosterPushStatusRecord {
  spreadsheetId: string | null;
  spreadsheetTitle: string;
  sheetTabs: string[];
  projects: RosterPushProjectRef[];
  ok: boolean;
  active: boolean;
  reason: string | null;
  message: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  writtenRows: number | null;
}

export interface RosterPushStatusResponse {
  statuses: RosterPushStatusRecord[];
  counts: { total: number; ok: number; failed: number; inactive: number };
  pendingPush: { queued: number; processing: number; oldestQueuedAt: string | null };
}

export async function fetchRosterPushStatusViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  signal?: AbortSignal;
  client?: PlatformApiClientLike;
}): Promise<RosterPushStatusResponse> {
  const client = params.client || createPlatformApiClient();
  const response = await client.get<RosterPushStatusResponse>(
    '/api/v1/participation-roster/push-status',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      signal: params.signal,
      timeoutMs: 10000,
    },
  );
  return response.data;
}

export async function triggerRosterPushViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  idempotencyKey: string;
  client?: PlatformApiClientLike;
}): Promise<{ ok: boolean; eventId: string; eventType: string; processed: boolean; succeeded: boolean }> {
  const client = params.client || createPlatformApiClient();
  const response = await client.post<{ ok: boolean; eventId: string; eventType: string; processed: boolean; succeeded: boolean }>(
    '/api/v1/participation-roster/push',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {},
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      // 인라인 즉시 반영이 팬아웃을 끝내고 돌아오므로 시트 수만큼 걸린다.
      // 넉넉히 잡는다 - 타임아웃돼도 이벤트는 대기열에 남아 크론이 이어받는다.
      timeoutMs: 60000,
    },
  );
  return response.data;
}
