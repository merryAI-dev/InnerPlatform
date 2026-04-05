import type { Project } from './types';

export interface ProjectMutationResult {
  id: string;
  version: number;
  updatedAt: string;
  trashedAt?: string | null;
}

export function mergeProjectMutationResult(
  project: Project,
  result: ProjectMutationResult,
  patch: Partial<Project> = {},
): Project {
  const nextProject: Project = {
    ...project,
    ...patch,
    version: result.version,
    updatedAt: result.updatedAt,
  };

  if (Object.prototype.hasOwnProperty.call(result, 'trashedAt')) {
    nextProject.trashedAt = result.trashedAt ?? null;
  }

  return nextProject;
}
