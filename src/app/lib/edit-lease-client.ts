import { PlatformApiError } from '../platform/api-client';
import type { RequestActor } from '../platform/request-context';
import {
  createPlatformApiClient,
  toRequestActor,
  type ActorLike,
} from './platform-bff-client';

export type EditLeaseResourceType = 'project-registration' | 'project-info' | 'cashflow';
export type EditLeaseState = 'AVAILABLE' | 'ACTIVE' | 'EXPIRED' | 'RELEASED';

interface EditLeaseStatusBase {
  serverNow: string;
  state: EditLeaseState;
  canEdit: boolean;
  expiresAt: string | null;
}

export interface EditLeaseOwnership extends EditLeaseStatusBase {
  state: 'ACTIVE';
  canEdit: true;
  expiresAt: string;
  leaseId: string;
  fence: number;
}

export interface EditLeaseHeldStatus extends EditLeaseStatusBase {
  state: 'ACTIVE';
  canEdit: false;
  expiresAt: string;
  holderDisplayName: string;
  sameActor: boolean;
}

export interface EditLeaseUnavailableStatus extends EditLeaseStatusBase {
  state: 'AVAILABLE' | 'EXPIRED' | 'RELEASED';
  canEdit: false;
}

export type EditLeaseStatus = EditLeaseOwnership | EditLeaseHeldStatus | EditLeaseUnavailableStatus;

export interface EditLeaseApiClient {
  get<T>(path: string, options: {
    tenantId: string;
    actor: RequestActor;
    headers?: HeadersInit;
  }): Promise<{ data: T }>;
  post<T>(path: string, options: {
    tenantId: string;
    actor: RequestActor;
    headers?: HeadersInit;
    body?: unknown;
  }): Promise<{ data: T }>;
}

export interface EditLeaseClient {
  getStatus(): Promise<EditLeaseStatus>;
  acquire(): Promise<EditLeaseOwnership>;
  extend(ownership: Pick<EditLeaseOwnership, 'leaseId' | 'fence'>): Promise<EditLeaseOwnership>;
  release(ownership: Pick<EditLeaseOwnership, 'leaseId' | 'fence'>): Promise<EditLeaseUnavailableStatus>;
}

export interface EditLeaseHolder {
  holderDisplayName: string;
  sameActor: boolean;
  expiresAt: string;
}

export class EditLeaseProtocolError extends Error {
  constructor(message = 'Invalid edit lease response') {
    super(message);
    this.name = 'EditLeaseProtocolError';
  }
}

export class EditLeaseClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly holder?: EditLeaseHolder;

  constructor(params: {
    message: string;
    status: number;
    code: string;
    requestId?: string;
    holder?: EditLeaseHolder;
  }) {
    super(params.message);
    this.name = 'EditLeaseClientError';
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.holder = params.holder;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EditLeaseProtocolError();
  }
  return value as Record<string, unknown>;
}

function iso(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (
    typeof value !== 'string'
    || !value
    || !Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== value
  ) {
    throw new EditLeaseProtocolError();
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new EditLeaseProtocolError();
  return value.trim();
}

function parseStatus(value: unknown): EditLeaseStatus {
  const body = record(value);
  const serverNow = iso(body.serverNow) as string;
  const states = new Set<EditLeaseState>(['AVAILABLE', 'ACTIVE', 'EXPIRED', 'RELEASED']);
  if (typeof body.state !== 'string' || !states.has(body.state as EditLeaseState)) {
    throw new EditLeaseProtocolError();
  }
  if (typeof body.canEdit !== 'boolean') throw new EditLeaseProtocolError();
  const state = body.state as EditLeaseState;

  if (state === 'ACTIVE' && body.canEdit) {
    const fence = body.fence;
    if (typeof fence !== 'number') throw new EditLeaseProtocolError();
    if (!Number.isSafeInteger(fence) || fence < 1) throw new EditLeaseProtocolError();
    return {
      serverNow,
      state,
      canEdit: true,
      expiresAt: iso(body.expiresAt) as string,
      leaseId: text(body.leaseId),
      fence,
    };
  }
  if (state === 'ACTIVE') {
    if (typeof body.sameActor !== 'boolean') throw new EditLeaseProtocolError();
    return {
      serverNow,
      state,
      canEdit: false,
      expiresAt: iso(body.expiresAt) as string,
      holderDisplayName: text(body.holderDisplayName),
      sameActor: body.sameActor,
    };
  }
  if (body.canEdit) throw new EditLeaseProtocolError();
  return {
    serverNow,
    state,
    canEdit: false,
    expiresAt: iso(body.expiresAt, true),
  };
}

function parseHolder(value: unknown): EditLeaseHolder {
  const holder = record(value);
  if (typeof holder.sameActor !== 'boolean') throw new EditLeaseProtocolError();
  return {
    holderDisplayName: text(holder.holderDisplayName),
    sameActor: holder.sameActor,
    expiresAt: iso(holder.expiresAt) as string,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof EditLeaseProtocolError || error instanceof EditLeaseClientError) return error;
  if (!(error instanceof PlatformApiError)) return error instanceof Error ? error : new Error('Edit lease request failed');
  const body = error.body && typeof error.body === 'object' ? error.body as Record<string, unknown> : {};
  const codeValue = body.error ?? body.code;
  const code = typeof codeValue === 'string' && codeValue ? codeValue : 'request_failed';

  if (error.status === 410 && code !== 'edit_lease_expired') throw new EditLeaseProtocolError();
  let holder: EditLeaseHolder | undefined;
  if (error.status === 423) {
    if (code !== 'edit_lease_held') throw new EditLeaseProtocolError();
    if (body.details !== undefined) holder = parseHolder(body.details);
  }
  return new EditLeaseClientError({
    message: error.status === 410 ? 'Edit lease expired' : error.status === 423 ? 'Edit lease held' : error.message,
    status: error.status,
    code,
    requestId: error.requestId,
    holder,
  });
}

function requireOwnership(value: unknown): EditLeaseOwnership {
  const status = parseStatus(value);
  if (!status.canEdit) throw new EditLeaseProtocolError();
  return status;
}

export function createEditLeaseClient(options: {
  tenantId: string;
  actor: ActorLike;
  sessionId: string;
  resourceType: EditLeaseResourceType;
  resourceId: string;
  client?: EditLeaseApiClient;
}): EditLeaseClient {
  const resourceTypes = new Set<EditLeaseResourceType>(['project-registration', 'project-info', 'cashflow']);
  const resourceId = options.resourceId.trim();
  const sessionId = options.sessionId.trim();
  if (
    !resourceTypes.has(options.resourceType)
    || !resourceId
    || resourceId !== options.resourceId
    || resourceId.includes('/')
    || !sessionId
  ) {
    throw new Error('Edit lease resource and session are required');
  }
  const client = options.client || createPlatformApiClient();
  const path = `/api/v1/edit-leases/${options.resourceType}/${encodeURIComponent(resourceId)}`;
  const actor = toRequestActor(options.actor);
  const sessionHeaders = { 'x-edit-session-id': sessionId };
  const request = async <T>(operation: () => Promise<{ data: unknown }>, parse: (value: unknown) => T): Promise<T> => {
    try {
      return parse((await operation()).data);
    } catch (error) {
      throw mapError(error);
    }
  };
  const ownershipHeaders = (ownership: Pick<EditLeaseOwnership, 'leaseId' | 'fence'>) => {
    const leaseId = text(ownership.leaseId);
    if (!Number.isSafeInteger(ownership.fence) || ownership.fence < 1) throw new EditLeaseProtocolError();
    return {
      ...sessionHeaders,
      'x-edit-lease-id': leaseId,
      'x-edit-fence': String(ownership.fence),
    };
  };
  const post = <T>(suffix: string, headers: HeadersInit, parse: (value: unknown) => T) => request<T>(
    () => client.post<unknown>(`${path}/${suffix}`, {
      tenantId: options.tenantId,
      actor,
      headers,
      body: {},
    }),
    parse,
  );

  return {
    getStatus: () => request(
      () => client.get<unknown>(path, { tenantId: options.tenantId, actor, headers: sessionHeaders }),
      parseStatus,
    ),
    acquire: () => post('acquire', sessionHeaders, requireOwnership),
    extend: (ownership) => post('extend', ownershipHeaders(ownership), requireOwnership),
    release: (ownership) => post('release', ownershipHeaders(ownership), (value) => {
      const status = parseStatus(value);
      if (status.canEdit || status.state !== 'RELEASED') throw new EditLeaseProtocolError();
      return status;
    }),
  };
}
