import type { Project } from '../data/types';
import { PROJECT_DEPARTMENT_OPTIONS } from '../data/project-department-options';

function normalizeRaw(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeStoredCic(value: unknown): string | undefined {
  const normalized = deriveProjectCicFromDepartment(value);
  if (!normalized || normalized === '미지정') return undefined;
  return normalized;
}

export function deriveProjectCicFromDepartment(department: unknown): string | undefined {
  const normalized = normalizeRaw(department);
  if (!normalized || normalized === '미지정') return undefined;
  const teamMatch = normalized.match(/^([a-z]{2,10})\s*team$/i);
  if (teamMatch) return `${teamMatch[1].toUpperCase()}팀`;
  return /^cic\s*\d+$/i.test(normalized)
    ? normalized.toUpperCase().replace(/\s+/g, '')
    : normalized;
}

export function normalizeProjectDepartment(value: unknown): string {
  return deriveProjectCicFromDepartment(value) || '';
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
