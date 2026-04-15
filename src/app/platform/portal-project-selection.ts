import type { Project, UserRole } from '../data/types';
import { normalizeProjectIds } from '../data/project-assignment';

export interface PortalProjectCandidateSet {
  priorityProjects: Project[];
  searchProjects: Project[];
}

const PORTAL_PATH_PREFIX = '/portal';
const PORTAL_PROJECT_SELECT_PATH = '/portal/project-select';
const PORTAL_PROJECT_SWITCH_FALLBACK_PATH = '/portal';
const ACTIVE_PORTAL_PROJECT_STORAGE_KEY = 'mysc-portal-active-project';
const ADMIN_PROJECT_ROLES = new Set<UserRole>(['admin', 'finance']);

function normalizeRole(role: unknown): UserRole | null {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalized === 'viewer') return 'pm';
  if (normalized === 'admin' || normalized === 'finance' || normalized === 'pm') return normalized;
  return null;
}

function normalizeProjectName(project: Project): string {
  const value = typeof project.name === 'string' ? project.name.trim() : '';
  return value || project.id;
}

function dedupeProjects(projects: Project[]): Project[] {
  const seen = new Set<string>();
  const result: Project[] = [];
  for (const project of projects) {
    if (!project?.id || seen.has(project.id)) continue;
    seen.add(project.id);
    result.push(project);
  }
  return result;
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const leftName = normalizeProjectName(left);
    const rightName = normalizeProjectName(right);
    if (leftName !== rightName) return leftName.localeCompare(rightName, 'ko');
    return left.id.localeCompare(right.id);
  });
}

function isPortalPath(pathname: string): boolean {
  return pathname === PORTAL_PATH_PREFIX || pathname.startsWith(`${PORTAL_PATH_PREFIX}/`);
}

export function getActivePortalProjectStorageKey(uid: string | null | undefined): string {
  return `${ACTIVE_PORTAL_PROJECT_STORAGE_KEY}:${String(uid || '').trim()}`;
}

export function readSessionActivePortalProjectId(uid: string | null | undefined): string {
  if (typeof sessionStorage === 'undefined') return '';
  try {
    return sessionStorage.getItem(getActivePortalProjectStorageKey(uid)) || '';
  } catch {
    return '';
  }
}

export function writeSessionActivePortalProjectId(
  uid: string | null | undefined,
  projectId: string | null | undefined,
): void {
  if (typeof sessionStorage === 'undefined') return;
  const storageKey = getActivePortalProjectStorageKey(uid);
  const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : '';
  try {
    if (normalizedProjectId) {
      sessionStorage.setItem(storageKey, normalizedProjectId);
    } else {
      sessionStorage.removeItem(storageKey);
    }
  } catch {
    // ignore sessionStorage failures
  }
}

export function resolvePortalProjectCandidates(input: {
  role: unknown;
  authUid?: string | null;
  assignedProjectIds?: string[];
  projects: Project[];
}): PortalProjectCandidateSet {
  const role = normalizeRole(input.role);
  const projects = dedupeProjects(sortProjects(input.projects || []));

  if (role && ADMIN_PROJECT_ROLES.has(role)) {
    return {
      priorityProjects: projects,
      searchProjects: projects,
    };
  }

  const assignedProjectIds = new Set(normalizeProjectIds(input.assignedProjectIds || []));
  const authUid = typeof input.authUid === 'string' ? input.authUid.trim() : '';
  const allowedProjects = projects.filter((project) => (
    assignedProjectIds.has(project.id) || (authUid && project.managerId === authUid)
  ));

  return {
    priorityProjects: allowedProjects,
    searchProjects: allowedProjects,
  };
}

export function resolveActivePortalProjectId(input: {
  activeProjectId?: string | null;
  primaryProjectId?: string | null;
  candidateProjectIds?: string[];
}): string {
  const candidateProjectIds = normalizeProjectIds(input.candidateProjectIds || []);
  const activeProjectId = typeof input.activeProjectId === 'string' ? input.activeProjectId.trim() : '';
  if (activeProjectId && candidateProjectIds.includes(activeProjectId)) return activeProjectId;

  const primaryProjectId = typeof input.primaryProjectId === 'string' ? input.primaryProjectId.trim() : '';
  if (primaryProjectId && candidateProjectIds.includes(primaryProjectId)) return primaryProjectId;

  return candidateProjectIds[0] || '';
}

export function resolvePortalProjectSelectPath(requestedPath?: string): string {
  const pathname = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (!isPortalPath(pathname)) return PORTAL_PROJECT_SELECT_PATH;
  if (pathname === PORTAL_PROJECT_SELECT_PATH) {
    return PORTAL_PROJECT_SELECT_PATH;
  }
  if (pathname.startsWith(`${PORTAL_PROJECT_SELECT_PATH}?`)) return pathname;
  return `${PORTAL_PROJECT_SELECT_PATH}?redirect=${encodeURIComponent(pathname)}`;
}

export function resolvePortalProjectSwitchPath(pathname?: string): string {
  const normalizedPath = typeof pathname === 'string' ? pathname.trim() : '';
  if (!isPortalPath(normalizedPath)) return PORTAL_PROJECT_SWITCH_FALLBACK_PATH;
  if (
    normalizedPath === PORTAL_PROJECT_SELECT_PATH
    || normalizedPath.startsWith(`${PORTAL_PROJECT_SELECT_PATH}/`)
    || normalizedPath.startsWith(`${PORTAL_PROJECT_SELECT_PATH}?`)
  ) {
    return PORTAL_PROJECT_SWITCH_FALLBACK_PATH;
  }
  return normalizedPath || PORTAL_PROJECT_SWITCH_FALLBACK_PATH;
}
