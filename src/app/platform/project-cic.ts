import type { Project } from '../data/types';
import { PROJECT_DEPARTMENT_OPTIONS } from '../data/project-department-options';

function normalizeRaw(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeStoredCic(value: unknown): string | undefined {
  const normalized = normalizeRaw(value);
  if (!normalized || normalized === '미지정') return undefined;
  return normalized;
}

export function deriveProjectCicFromDepartment(department: unknown): string | undefined {
  const normalized = normalizeRaw(department);
  if (!normalized || normalized === '미지정') return undefined;

  if (/^cic\s*\d+$/i.test(normalized)) {
    return normalized.toUpperCase().replace(/\s+/g, '');
  }

  if (/cic/i.test(normalized)) {
    return normalized;
  }

  return undefined;
}

export function resolveProjectCic(projectLike: Pick<Project, 'cic' | 'department'> | { cic?: string; department?: string }): string | undefined {
  return normalizeStoredCic(projectLike.cic) || deriveProjectCicFromDepartment(projectLike.department);
}

export function getProjectRegistrationCicOptions(): string[] {
  return Array.from(new Set(
    PROJECT_DEPARTMENT_OPTIONS
      .map((department) => deriveProjectCicFromDepartment(department))
      .filter((value): value is string => Boolean(value)),
  )).sort((left, right) => left.localeCompare(right, 'ko'));
}
