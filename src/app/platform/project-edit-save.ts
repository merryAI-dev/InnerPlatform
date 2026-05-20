import type { Project } from '../data/types';
import { PlatformApiError } from './api-client';

function normalizeExpectedVersion(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

export function buildPortalProjectEditSavePayload({
  baseProject,
  latestProject,
  patch,
  orgId,
  updatedAt,
}: {
  baseProject: Project;
  latestProject?: Project | null;
  patch: Partial<Project>;
  orgId: string;
  updatedAt: string;
}): { project: Project; expectedVersion: number } {
  const sourceProject = latestProject || baseProject;
  const expectedVersion = normalizeExpectedVersion(sourceProject.version);
  return {
    expectedVersion,
    project: {
      ...sourceProject,
      ...patch,
      id: baseProject.id,
      orgId: sourceProject.orgId || baseProject.orgId || orgId,
      updatedAt,
    } as Project,
  };
}

export function isProjectVersionConflictError(error: unknown): boolean {
  if (!(error instanceof PlatformApiError) || error.status !== 409) return false;
  const body = error.body as { error?: unknown } | null | undefined;
  const code = typeof body?.error === 'string' ? body.error : '';
  return code === 'version_conflict' || code === 'version_required';
}
