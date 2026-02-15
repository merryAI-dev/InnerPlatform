import { createHash, randomUUID } from 'node:crypto';

const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function createRequestId(prefix = 'req') {
  return `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function normalizeTenantId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function assertTenantId(value) {
  const tenantId = normalizeTenantId(value);
  if (!tenantId || !TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error(`Invalid tenant id: ${String(value)}`);
  }
  return tenantId;
}

export function normalizeActorId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    throw new Error('x-actor-id header is required');
  }
  return raw.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '_');
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      sorted[key] = stableSort(value[key]);
    }
    return sorted;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function buildRequestFingerprint({ method, path, body }) {
  return sha256(`${method.toUpperCase()}|${path}|${stableStringify(body ?? null)}`);
}
