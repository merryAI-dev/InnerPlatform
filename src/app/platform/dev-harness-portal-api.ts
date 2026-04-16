import { ORG_MEMBERS, PROJECTS } from '../data/mock-data';

type PortalEntryProjectSummary = {
  id: string;
  name: string;
  status: string;
  clientOrg: string;
  managerName: string;
  department: string;
  type?: string;
};

type PortalEntryContextResult = {
  registrationState: 'registered' | 'unregistered';
  activeProjectId: string;
  priorityProjectIds: string[];
  projects: PortalEntryProjectSummary[];
};

type PortalOnboardingContextResult = {
  registrationState: 'registered' | 'unregistered';
  activeProjectId: string;
  projects: PortalEntryProjectSummary[];
};

type PortalRegistrationResult = {
  ok: boolean;
  registrationState: 'registered';
  activeProjectId: string;
  projectIds: string[];
};

type PortalSessionProjectResult = {
  ok: boolean;
  activeProjectId: string;
};

const PRIVILEGED_ROLES = new Set(['admin', 'finance']);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'viewer' ? 'pm' : normalized;
}

function normalizeProjectIds(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
}

function resolvePrimaryProjectId(projectIds: string[], preferredProjectId?: string): string {
  const preferred = normalizeText(preferredProjectId);
  if (preferred && projectIds.includes(preferred)) return preferred;
  return projectIds[0] || '';
}

function resolveDefaultPmProjectId(): string {
  return PROJECTS.find((project) => project.status === 'CONTRACT_PENDING')?.id
    || PROJECTS[0]?.id
    || '';
}

function normalizeProject(project: Record<string, unknown>): PortalEntryProjectSummary {
  const id = normalizeText(project.id);
  return {
    id,
    name: normalizeText(project.name) || id,
    status: normalizeText(project.status) || 'CONTRACT_PENDING',
    clientOrg: normalizeText(project.clientOrg),
    managerName: normalizeText(project.managerName),
    department: normalizeText(project.department),
    type: normalizeText(project.type) || undefined,
  };
}

function listVisibleProjects(actorId: string, actorRole: string): {
  projects: PortalEntryProjectSummary[];
  priorityProjectIds: string[];
} {
  const activeProjects = PROJECTS.filter((project) => !normalizeText((project as Record<string, unknown>).trashedAt));
  if (PRIVILEGED_ROLES.has(actorRole)) {
    return {
      projects: activeProjects
        .map((project) => normalizeProject(project as unknown as Record<string, unknown>))
        .sort((left, right) => left.name.localeCompare(right.name, 'ko')),
      priorityProjectIds: [],
    };
  }

  const assignedProjectIds = normalizeProjectIds([resolveDefaultPmProjectId()]);
  const projects = activeProjects
    .filter((project) => assignedProjectIds.includes(project.id) || normalizeText(project.managerId) === actorId)
    .map((project) => normalizeProject(project as unknown as Record<string, unknown>))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));

  const priorityProjectIds = normalizeProjectIds([
    ...assignedProjectIds,
    ...projects
      .filter((project) => normalizeText(project.id))
      .map((project) => project.id),
  ]);

  return { projects, priorityProjectIds };
}

function resolveRegistrationState(actorRole: string, projectIds: string[]): 'registered' | 'unregistered' {
  if (PRIVILEGED_ROLES.has(actorRole)) return 'registered';
  return projectIds.length > 0 ? 'registered' : 'unregistered';
}

export function buildDevHarnessPortalEntryContext(params: {
  actorId?: string;
  actorRole?: string;
}): PortalEntryContextResult {
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'pm')?.uid || 'u002';
  const actorRole = normalizeRole(params.actorRole) || 'pm';
  const { projects, priorityProjectIds } = listVisibleProjects(actorId, actorRole);
  const activeProjectId = resolvePrimaryProjectId(priorityProjectIds, priorityProjectIds[0]);

  return {
    registrationState: resolveRegistrationState(actorRole, priorityProjectIds),
    activeProjectId,
    priorityProjectIds,
    projects,
  };
}

export function buildDevHarnessPortalOnboardingContext(params: {
  actorRole?: string;
}): PortalOnboardingContextResult {
  const actorRole = normalizeRole(params.actorRole) || 'pm';
  const projects = PROJECTS
    .filter((project) => !normalizeText((project as Record<string, unknown>).trashedAt))
    .map((project) => normalizeProject(project as unknown as Record<string, unknown>))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  const defaultProjectIds = PRIVILEGED_ROLES.has(actorRole) ? [] : normalizeProjectIds([resolveDefaultPmProjectId()]);

  return {
    registrationState: resolveRegistrationState(actorRole, defaultProjectIds),
    activeProjectId: resolvePrimaryProjectId(defaultProjectIds, defaultProjectIds[0]),
    projects,
  };
}

export function buildDevHarnessPortalSessionProjectResult(projectId: string): PortalSessionProjectResult {
  const normalizedProjectId = normalizeText(projectId);
  const exists = PROJECTS.some((project) => project.id === normalizedProjectId);
  if (!exists) {
    throw new Error('project_not_found');
  }
  return {
    ok: true,
    activeProjectId: normalizedProjectId,
  };
}

export function buildDevHarnessPortalRegistrationResult(params: {
  projectId?: string;
  projectIds?: string[];
}): PortalRegistrationResult {
  const normalizedProjectIds = normalizeProjectIds([
    ...(Array.isArray(params.projectIds) ? params.projectIds : []),
    params.projectId,
  ]);
  const activeProjectId = resolvePrimaryProjectId(normalizedProjectIds, params.projectId || normalizedProjectIds[0]);
  if (!activeProjectId) {
    throw new Error('project_required');
  }

  return {
    ok: true,
    registrationState: 'registered',
    activeProjectId,
    projectIds: normalizedProjectIds,
  };
}
