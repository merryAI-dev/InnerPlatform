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

export function isAdminSpaceRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return ADMIN_SPACE_ROLES.has(normalized);
}

export function resolveHomePath(role: unknown): HomePath {
  const normalized = normalizeRole(role);
  if (!normalized) return '/portal';
  if (isPortalRole(normalized)) return '/portal';
  if (isAdminSpaceRole(normalized)) return '/';
  // Least privilege: unknown roles land in the portal space.
  return '/portal';
}

interface PortalOnboardingRedirectInput {
  isAuthenticated: boolean;
  role: unknown;
  isRegistered: boolean;
  pathname: string;
}

/**
 * Decide whether we should force a portal user into onboarding.
 * Admin-space roles must never be forced into portal onboarding.
 */
export function shouldForcePortalOnboarding(input: PortalOnboardingRedirectInput): boolean {
  if (!input.isAuthenticated) return false;
  if (resolveHomePath(input.role) !== '/portal') return false;
  if (input.isRegistered) return false;
  return !input.pathname.includes('/portal/onboarding');
}
