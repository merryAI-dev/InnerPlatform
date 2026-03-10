import { normalizeProjectIds, resolvePrimaryProjectId } from './project-assignment';

export type WorkspaceId = 'admin' | 'portal';

export interface MemberPortalProfile {
  projectId?: string;
  projectIds: string[];
  projectNames?: Record<string, string>;
  updatedAt?: string;
  updatedByUid?: string;
  updatedByName?: string;
}

export interface MemberWorkspaceState {
  defaultWorkspace?: WorkspaceId;
  lastWorkspace?: WorkspaceId;
  portalProfile: MemberPortalProfile | null;
}

interface BuildPortalProfilePatchInput {
  projectId?: string;
  projectIds?: string[];
  projectNames?: Record<string, string>;
  updatedAt?: string;
  updatedByUid?: string;
  updatedByName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeWorkspaceId(value: unknown): WorkspaceId | undefined {
  if (value === 'admin' || value === 'portal') return value;
  return undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readString(entry))
    .filter(Boolean);
}

function readProjectNames(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, raw]) => [key.trim(), readString(raw)] as const)
    .filter(([key, name]) => key && name);

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function mergeProjectNames(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged = Object.assign({}, ...sources.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function readMemberWorkspace(candidate: unknown): MemberWorkspaceState {
  if (!isRecord(candidate)) {
    return { portalProfile: null };
  }

  const rawPortalProfile = isRecord(candidate.portalProfile) ? candidate.portalProfile : null;
  const projectNames = mergeProjectNames(
    readProjectNames(candidate.projectNames),
    readProjectNames(rawPortalProfile?.projectNames),
  );
  const projectIds = normalizeProjectIds([
    ...readStringArray(candidate.projectIds),
    readString(candidate.projectId),
    ...readStringArray(rawPortalProfile?.projectIds),
    readString(rawPortalProfile?.projectId),
  ]);
  const projectId = resolvePrimaryProjectId(
    projectIds,
    readString(rawPortalProfile?.projectId) || readString(candidate.projectId),
  );

  return {
    defaultWorkspace: normalizeWorkspaceId(candidate.defaultWorkspace),
    lastWorkspace: normalizeWorkspaceId(candidate.lastWorkspace),
    portalProfile: projectIds.length > 0 || projectId
      ? {
        projectId: projectId || undefined,
        projectIds,
        ...(projectNames ? { projectNames } : {}),
        ...(readString(rawPortalProfile?.updatedAt) ? { updatedAt: readString(rawPortalProfile?.updatedAt) } : {}),
        ...(readString(rawPortalProfile?.updatedByUid) ? { updatedByUid: readString(rawPortalProfile?.updatedByUid) } : {}),
        ...(readString(rawPortalProfile?.updatedByName) ? { updatedByName: readString(rawPortalProfile?.updatedByName) } : {}),
      }
      : null,
  };
}

export function buildWorkspacePreferencePatch(
  workspace: WorkspaceId,
  updatedAt: string = new Date().toISOString(),
  persistDefault: boolean = true,
): Record<string, unknown> {
  return {
    ...(persistDefault ? { defaultWorkspace: workspace } : {}),
    lastWorkspace: workspace,
    updatedAt,
  };
}

export function buildPortalProfilePatch(input: BuildPortalProfilePatchInput): Record<string, unknown> {
  const projectIds = normalizeProjectIds([
    ...(Array.isArray(input.projectIds) ? input.projectIds : []),
    input.projectId,
  ]);
  const projectId = resolvePrimaryProjectId(projectIds, input.projectId);
  const updatedAt = input.updatedAt || new Date().toISOString();
  const projectNames = mergeProjectNames(input.projectNames);

  return {
    ...buildWorkspacePreferencePatch('portal', updatedAt, true),
    projectId: projectId || '',
    projectIds,
    portalProfile: {
      ...(projectId ? { projectId } : {}),
      projectIds,
      ...(projectNames ? { projectNames } : {}),
      updatedAt,
      ...(readString(input.updatedByUid) ? { updatedByUid: readString(input.updatedByUid) } : {}),
      ...(readString(input.updatedByName) ? { updatedByName: readString(input.updatedByName) } : {}),
    },
  };
}
