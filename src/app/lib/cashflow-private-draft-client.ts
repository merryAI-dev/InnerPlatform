import type { RequestActor } from '../platform/request-context';
import {
  createPlatformApiClient,
  toRequestActor,
  type ActorLike,
  type PlatformApiClientLike,
} from './platform-bff-client';
import { cashflowMutationHeaders } from './cashflow-edit-lease';

export interface CashflowPrivateDraft {
  projectId: string;
  resourceType: 'cashflow';
  resourceId: string;
  draftRevision: number;
  baseSnapshot?: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: 'ACTIVE' | 'SUBMITTED' | 'DISCARDED';
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
}

type CashflowPrivateDraftApiClient = Pick<PlatformApiClientLike, 'get' | 'post' | 'patch'>;

function safeProjectId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.length > 512) {
    throw new Error('project ID is invalid');
  }
  return normalized;
}

function safeSessionId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes('/') || /\s/.test(normalized)) throw new Error('edit session ID is invalid');
  return normalized;
}

function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('draft revision is invalid');
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} response`);
  return value as Record<string, unknown>;
}

function parseDraft(value: unknown, projectId: string): CashflowPrivateDraft {
  const draft = object(value, 'cashflow private draft');
  const statuses = new Set(['ACTIVE', 'SUBMITTED', 'DISCARDED']);
  if (
    draft.projectId !== projectId
    || draft.resourceType !== 'cashflow'
    || draft.resourceId !== projectId
    || !statuses.has(String(draft.status))
  ) throw new Error('Invalid cashflow private draft response');
  return {
    ...(draft as unknown as CashflowPrivateDraft),
    projectId,
    resourceType: 'cashflow',
    resourceId: projectId,
    draftRevision: revision(Number(draft.draftRevision)),
    payload: object(draft.payload ?? {}, 'cashflow private draft payload'),
  };
}

function parseDraftBody(value: unknown, projectId: string) {
  return { draft: parseDraft(object(value, 'cashflow private draft').draft, projectId) };
}

export function createCashflowPrivateDraftClient(options: {
  tenantId: string;
  actor: ActorLike;
  sessionId: string;
  projectId: string;
  client?: CashflowPrivateDraftApiClient;
}) {
  const client = options.client || createPlatformApiClient();
  const actor: RequestActor = toRequestActor(options.actor);
  const projectId = safeProjectId(options.projectId);
  const sessionId = safeSessionId(options.sessionId);
  const path = `/api/v1/cashflow-edit-drafts/${encodeURIComponent(projectId)}`;
  const request = { tenantId: options.tenantId, actor };
  const headers = (ownership: { leaseId: string; fence: number }) => cashflowMutationHeaders({
    sessionId,
    leaseId: ownership.leaseId,
    fence: ownership.fence,
  });

  return {
    async get() {
      const response = await client.get<unknown>(path, {
        ...request,
        headers: { 'x-edit-session-id': sessionId },
      });
      return parseDraftBody(response.data, projectId);
    },
    async open(
      ownership: { leaseId: string; fence: number },
      input: { baseSnapshot?: Record<string, unknown>; payload?: Record<string, unknown> } = {},
    ) {
      const response = await client.post<unknown>(`${path}/open`, {
        ...request,
        headers: headers(ownership),
        body: { baseSnapshot: input.baseSnapshot || {}, payload: input.payload || {} },
      });
      return parseDraftBody(response.data, projectId);
    },
    async save(
      ownership: { leaseId: string; fence: number },
      input: { expectedDraftRevision: number; payload: Record<string, unknown> },
    ) {
      const response = await client.patch<unknown>(path, {
        ...request,
        headers: headers(ownership),
        body: { expectedDraftRevision: revision(input.expectedDraftRevision), payload: input.payload },
      });
      return parseDraftBody(response.data, projectId);
    },
    async complete(
      ownership: { leaseId: string; fence: number },
      input: { expectedDraftRevision: number },
    ) {
      const response = await client.post<unknown>(`${path}/complete`, {
        ...request,
        headers: headers(ownership),
        body: { expectedDraftRevision: revision(input.expectedDraftRevision) },
      });
      return parseDraftBody(response.data, projectId);
    },
  };
}
