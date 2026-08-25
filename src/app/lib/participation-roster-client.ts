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
}): Promise<{ ok: boolean; eventId: string; eventType: string }> {
  const client = params.client || createPlatformApiClient();
  const response = await client.post<{ ok: boolean; eventId: string; eventType: string }>(
    '/api/v1/participation-roster/push',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {},
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 15000,
    },
  );
  return response.data;
}
