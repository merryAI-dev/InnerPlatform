import { normalizeWorkspaceId, type WorkspaceId } from '../data/member-workspace';
import { canAccessAdminPath } from './admin-nav';
import { resolvePortalProjectSelectPath } from './portal-project-selection';

export type HomePath = '/' | '/portal';

function normalizeRole(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'viewer' ? 'pm' : normalized;
}

const ADMIN_SPACE_ROLES = new Set([
  'admin',
  'finance',
]);

export function isPortalRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'pm';
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
  return isAdminSpaceRole(role);
}

export function shouldPromptWorkspaceSelection(
  role: unknown,
  preferredWorkspace: unknown,
): boolean {
  if (!canChooseWorkspace(role)) return false;
  return normalizeWorkspaceId(preferredWorkspace) == null;
}

export function resolveActiveWorkspacePreference(
  lastWorkspace?: WorkspaceId | unknown,
  defaultWorkspace?: WorkspaceId | unknown,
): WorkspaceId | undefined {
  return normalizeWorkspaceId(lastWorkspace) ?? normalizeWorkspaceId(defaultWorkspace);
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

export function normalizeRequestedPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return '';
  if (trimmed === '/login' || trimmed === '/workspace-select') return '';
  return trimmed;
}

export function resolveRequestedRedirectPath(
  stateFrom?: unknown,
  search?: unknown,
): string {
  const fromState = normalizeRequestedPath(stateFrom);
  if (fromState) return fromState;
  const searchText = typeof search === 'string' ? search : '';
  const params = new URLSearchParams(searchText);
  return normalizeRequestedPath(params.get('redirect'));
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

  if (canAccessAdminPath(role, normalizedPath)) {
    return normalizedPath;
  }

  return fallback;
}

export function resolvePortalEntryPath(
  role: unknown,
  preferredWorkspace: WorkspaceId | unknown,
  requestedPath?: unknown,
): string {
  const target = resolvePostLoginPath(role, preferredWorkspace, requestedPath);
  if (target === '/portal' || target.startsWith('/portal/')) {
    return resolvePortalProjectSelectPath(target);
  }
  return target;
}

interface PortalOnboardingRedirectInput {
  isAuthenticated: boolean;
  role: unknown;
  isRegistered: boolean;
  pathname: string;
}

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
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
  // onboarding, project-settings, weekly-expenses는 미등록 상태에서도 접근 허용
  const bypassPaths = ['/portal/onboarding', '/portal/project-settings', '/portal/project-select', '/portal/register-project', '/portal/weekly-expenses'];
  return !bypassPaths.some((p) => matchesPathPrefix(input.pathname, p));
}
