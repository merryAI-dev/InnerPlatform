import { assertTenantId } from './tenant';

export interface RequestActor {
  id: string;
  email?: string;
  role?: string;
  idToken?: string;
}

export interface BuildStandardHeadersInput {
  tenantId: string;
  actor: RequestActor;
  method?: string;
  requestId?: string;
  idempotencyKey?: string;
  headers?: HeadersInit;
}

function normalizeActorId(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return 'system';
  return trimmed.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_');
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Math.random().toString(36).slice(2, 18);
}

export function createRequestId(prefix: string = 'req'): string {
  return `${prefix}_${Date.now()}_${randomToken()}`;
}

export function isMutationMethod(method: string | undefined): boolean {
  const normalized = (method || 'GET').trim().toUpperCase();
  return normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH' || normalized === 'DELETE';
}

export function createIdempotencyKey(method: string, actorId: string): string {
  const normalizedMethod = (method || 'POST').toUpperCase();
  const normalizedActorId = normalizeActorId(actorId);
  return `idem_${normalizedMethod}_${normalizedActorId}_${randomToken()}`;
}

export function buildStandardHeaders(input: BuildStandardHeadersInput): Headers {
  const tenantId = assertTenantId(input.tenantId);
  const method = (input.method || 'GET').toUpperCase();
  const actorId = normalizeActorId(input.actor.id);
  const headers = new Headers(input.headers || {});

  if (!headers.get('x-request-id')) {
    headers.set('x-request-id', input.requestId || createRequestId());
  }

  headers.set('x-tenant-id', tenantId);
  headers.set('x-actor-id', actorId);

  if (input.actor.email && !headers.get('x-actor-email')) {
    headers.set('x-actor-email', input.actor.email.trim().toLowerCase());
  }

  if (input.actor.role && !headers.get('x-actor-role')) {
    headers.set('x-actor-role', input.actor.role);
  }

  if (input.actor.idToken && !headers.get('authorization')) {
    headers.set('authorization', `Bearer ${input.actor.idToken}`);
  }

  if (isMutationMethod(method) && !headers.get('idempotency-key')) {
    headers.set('idempotency-key', input.idempotencyKey || createIdempotencyKey(method, actorId));
  }

  return headers;
}
