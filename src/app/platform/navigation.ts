import { normalizeWorkspaceId, type WorkspaceId } from '../data/member-workspace';
import { canAccessAdminPath } from './admin-nav';

export type HomePath = '/' | '/portal';

function normalizeRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const ADMIN_SPACE_ROLES = new Set([
  'admin',
  'finance',
]);

export function isPortalRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'pm' || normalized === 'viewer';
}

export function isAdminSpaceRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return ADMIN_SPACE_ROLES.has(normalized);
}

export function canEnterPortalWorkspace(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return !!normalized;
}

export function canChooseWorkspace(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return !!normalized;
}

export function shouldPromptWorkspaceSelection(
  role: unknown,
  preferredWorkspace: unknown,
): boolean {
  if (!canChooseWorkspace(role)) return false;
  // 항상 workspace 선택 화면 표시 — 사용자가 매번 admin/portal 선택 가능
  return true;
}

export function resolveHomePath(role: unknown, preferredWorkspace?: WorkspaceId | unknown): HomePath {
  const normalized = normalizeRole(role);
  if (!normalized) return '/portal';
  if (isPortalRole(normalized)) return '/portal';
  if (normalized === 'admin' && normalizeWorkspaceId(preferredWorkspace) === 'portal') {
    return '/portal';
  }
  if (isAdminSpaceRole(normalized)) return '/';
  return '/portal';
}

function normalizeRequestedPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return '';
  if (trimmed === '/login' || trimmed === '/workspace-select') return '';
  return trimmed;
}

export function resolvePostLoginPath(
  role: unknown,
  preferredWorkspace: WorkspaceId | unknown,
  requestedPath?: unknown,
): string {
  const fallback = resolveHomePath(role, preferredWorkspace);
  const normalizedPath = normalizeRequestedPath(requestedPath);
  if (!normalizedPath) return fallback;

  if (normalizedPath === '/portal' || normalizedPath.startsWith('/portal/')) {
    return canEnterPortalWorkspace(role) ? normalizedPath : fallback;
  }

  if (!isPortalRole(role) && canAccessAdminPath(role, normalizedPath)) {
    return normalizedPath;
  }

  return fallback;
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
  if (isAdminSpaceRole(input.role)) return false;
  if (!canEnterPortalWorkspace(input.role)) return false;
  if (input.isRegistered) return false;
  return !input.pathname.includes('/portal/onboarding');
}
