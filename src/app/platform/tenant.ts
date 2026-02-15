const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface ResolveTenantIdOptions {
  claimTenantId?: unknown;
  savedTenantId?: unknown;
  envTenantId?: unknown;
  defaultTenantId?: string;
  strict?: boolean;
}

function normalizeUnknown(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeTenantId(value: unknown): string {
  return normalizeUnknown(value);
}

export function isValidTenantId(value: unknown): value is string {
  const normalized = normalizeTenantId(value);
  return normalized.length > 0 && TENANT_ID_PATTERN.test(normalized);
}

export function assertTenantId(value: unknown): string {
  const normalized = normalizeTenantId(value);
  if (!isValidTenantId(normalized)) {
    throw new Error(`Invalid tenant id: ${String(value)}`);
  }
  return normalized;
}

export function resolveTenantId(options: ResolveTenantIdOptions = {}): string {
  const {
    claimTenantId,
    savedTenantId,
    envTenantId,
    defaultTenantId = 'mysc',
    strict = true,
  } = options;

  const candidates = [claimTenantId, savedTenantId, envTenantId, defaultTenantId];
  for (const candidate of candidates) {
    const normalized = normalizeTenantId(candidate);
    if (!normalized) continue;

    if (isValidTenantId(normalized)) {
      return normalized;
    }

    if (strict) {
      throw new Error(`Invalid tenant id candidate: ${String(candidate)}`);
    }
  }

  return strict ? assertTenantId(defaultTenantId) : 'mysc';
}

function normalizePathSegment(segment: string): string {
  const cleaned = segment.trim();
  if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.includes('/')) {
    throw new Error(`Invalid path segment: ${segment}`);
  }
  if (!PATH_SEGMENT_PATTERN.test(cleaned)) {
    throw new Error(`Invalid path segment: ${segment}`);
  }
  return cleaned;
}

export function buildTenantScopedPath(tenantId: string, ...segments: string[]): string {
  const normalizedTenantId = assertTenantId(tenantId);
  const normalizedSegments = segments.map(normalizePathSegment);
  return ['orgs', normalizedTenantId, ...normalizedSegments].join('/');
}
