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
    || (authUid && !project.registeredById && project.managerId === authUid)
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

  const primaryProjectId = typeof input.primaryProjectId === 'string' ? input.primaryProjectId.trim() : '';
  if (primaryProjectId && candidateProjectIds.includes(primaryProjectId)) return primaryProjectId;

  return candidateProjectIds[0] || '';
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
