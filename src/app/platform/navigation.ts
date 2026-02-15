export type HomePath = '/' | '/portal';

function normalizeRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const ADMIN_SPACE_ROLES = new Set([
  'admin',
  'finance',
  'auditor',
  'tenant_admin',
  'support',
  'security',
]);

export function isPortalRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'pm' || normalized === 'viewer';
}

export function resolveHomePath(role: unknown): HomePath {
  const normalized = normalizeRole(role);
  if (!normalized) return '/portal';
  if (isPortalRole(normalized)) return '/portal';
  if (ADMIN_SPACE_ROLES.has(normalized)) return '/';
  // Least privilege: unknown roles land in the portal space.
  return '/portal';
}
