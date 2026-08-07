import type { Project, UserRole } from '../data/types';
import { normalizeProjectIds } from '../data/project-assignment';

export interface PortalProjectCandidateSet {
  priorityProjects: Project[];
  searchProjects: Project[];
}

const PORTAL_PATH_PREFIX = '/portal';
const PORTAL_PROJECT_SELECT_PATH = '/portal/project-select';
const PORTAL_PROJECT_SWITCH_FALLBACK_PATH = '/portal/budget';

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

export function resolvePortalProjectCandidates(input: {
  role: unknown;
  authUid?: string | null;
  assignedProjectIds?: string[];
  projects: Project[];
}): PortalProjectCandidateSet {
  const role = normalizeRole(input.role);
  const projects = dedupeProjects(sortProjects(input.projects || []));

  if (!role) {
    return {
      priorityProjects: [],
      searchProjects: [],
    };
  }

  const assignedProjectIds = new Set(normalizeProjectIds(input.assignedProjectIds || []));
  const authUid = typeof input.authUid === 'string' ? input.authUid.trim() : '';
  const priorityProjects = projects.filter((project) => (
    assignedProjectIds.has(project.id)
    || (authUid && project.registeredById === authUid)
    || (authUid && project.managerId === authUid)
    || (authUid && project.executiveApproverId === authUid)
  ));

  return {
    priorityProjects,
    searchProjects: projects,
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
  return '';
}

export function resolvePortalProjectSelectPath(requestedPath?: string): string {
  const pathname = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (!isPortalPath(pathname)) return PORTAL_PROJECT_SELECT_PATH;
  return PORTAL_PROJECT_SELECT_PATH;
}

export function resolvePortalProjectSwitchPath(pathname?: string): string {
  const normalizedPath = typeof pathname === 'string' ? pathname.trim() : '';
  if (!isPortalPath(normalizedPath)) return PORTAL_PROJECT_SWITCH_FALLBACK_PATH;
  if (
    normalizedPath === PORTAL_PATH_PREFIX
    || normalizedPath.startsWith(`${PORTAL_PATH_PREFIX}?`)
    || normalizedPath.startsWith(`${PORTAL_PATH_PREFIX}#`)
    || normalizedPath === PORTAL_PROJECT_SELECT_PATH
    || normalizedPath.startsWith(`${PORTAL_PROJECT_SELECT_PATH}/`)
    || normalizedPath.startsWith(`${PORTAL_PROJECT_SELECT_PATH}?`)
  ) {
    return PORTAL_PROJECT_SWITCH_FALLBACK_PATH;
  }
  return normalizedPath || PORTAL_PROJECT_SWITCH_FALLBACK_PATH;
}

function normalizedId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolvePortalProjectResourceId(
  routeProjectId?: string | null,
  ...fallbackProjectIds: Array<string | null | undefined>
): string {
  return [routeProjectId, ...fallbackProjectIds].map(normalizedId).find(Boolean) || '';
}

export function resolvePortalRouteProjectId(pathname?: string | null): string {
  const normalizedPath = typeof pathname === 'string' ? pathname.trim() : '';
  const match = normalizedPath.match(/^\/portal\/(?:cashflow\/([^/]+)(?:\/sheets-lab)?|edit-project\/([^/]+))\/?$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1] || match[2] || '').trim();
  } catch {
    return '';
  }
}

export function resolvePortalProjectResourcePath(requestedPath: string, projectId: string): string {
  const normalizedProjectId = normalizedId(projectId);
  const normalizedPath = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (!normalizedProjectId || !normalizedPath) return normalizedPath;

  const suffixIndex = [normalizedPath.indexOf('?'), normalizedPath.indexOf('#')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? normalizedPath.length;
  const pathname = normalizedPath.slice(0, suffixIndex).replace(/\/+$/, '');
  const suffix = normalizedPath.slice(suffixIndex);
  const encodedProjectId = encodeURIComponent(normalizedProjectId);

  if (/^\/portal\/edit-project(?:\/[^/]+)?$/.test(pathname)) {
    return `/portal/edit-project/${encodedProjectId}${suffix}`;
  }
  if (
    pathname === '/portal/cashflow/sheets-lab'
    || /^\/portal\/cashflow\/[^/]+\/sheets-lab$/.test(pathname)
  ) {
    return `/portal/cashflow/${encodedProjectId}/sheets-lab${suffix}`;
  }
  if (pathname === '/portal/cashflow' || /^\/portal\/cashflow\/[^/]+$/.test(pathname)) {
    return `/portal/cashflow/${encodedProjectId}${suffix}`;
  }
  return normalizedPath;
}

export type PortalProjectContextAction = 'idle' | 'canonicalize-path';

export interface PortalProjectContextSync {
  projectId: string;
  action: PortalProjectContextAction;
  path: string;
}

/**
 * 프로젝트 단위 URL은 새로고침과 직접 진입에서도 같은 프로젝트를 열어야 한다.
 * URL에 프로젝트가 없을 때만 세션 선택값으로 canonical path를 만든다.
 */
export function resolvePortalProjectContextSync(input: {
  routeProjectId?: string | null;
  sessionProjectId?: string | null;
  previousSessionProjectId?: string | null;
  fallbackProjectId?: string | null;
  currentPath: string;
}): PortalProjectContextSync {
  const routeProjectId = normalizedId(input.routeProjectId);
  const sessionProjectId = normalizedId(input.sessionProjectId);
  if (routeProjectId) return { projectId: routeProjectId, action: 'idle', path: '' };
  if (!sessionProjectId) return { projectId: '', action: 'idle', path: '' };
  return {
    projectId: sessionProjectId,
    action: 'canonicalize-path',
    path: resolvePortalProjectResourcePath(input.currentPath, sessionProjectId),
  };
}

export async function runPortalProjectSwitch(input: {
  projectId: string;
  currentPath: string;
  label: string;
  isNavigationBlocked: (attempt: { path: string; label: string }) => boolean;
  setActiveProject: (projectId: string) => Promise<boolean>;
  navigate: (path: string) => void;
}): Promise<boolean> {
  const projectId = normalizedId(input.projectId);
  if (!projectId) return false;
  const targetPath = resolvePortalProjectResourcePath(input.currentPath, projectId);
  if (input.isNavigationBlocked({ path: targetPath, label: input.label })) return false;
  if (!await input.setActiveProject(projectId)) return false;
  input.navigate(targetPath);
  return true;
}
