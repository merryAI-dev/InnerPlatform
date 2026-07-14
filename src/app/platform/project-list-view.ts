import type { Project } from '../data/types';
import { normalizeSettlementType } from '../data/types';
import { matchesProjectSearch } from './project-search';

export function groupProjectListItems(projects: Project[]) {
  const active = projects.filter((project) => !project.trashedAt);
  return {
    active,
    contractPending: active.filter((project) => project.status === 'CONTRACT_PENDING'),
    inProgress: active.filter((project) => project.status === 'IN_PROGRESS'),
    completed: active.filter((project) => (
      project.status === 'COMPLETED' || project.status === 'COMPLETED_PENDING_PAYMENT'
    )),
    trashed: projects.filter((project) => !!project.trashedAt),
  };
}

export function matchesProjectListFilters(project: Project, filters: {
  search: string;
  status: string;
  settlementType: string;
  department: string;
}) {
  if (!matchesProjectSearch(project, filters.search)) return false;
  if (filters.status !== 'ALL' && project.status !== filters.status) return false;
  if (filters.settlementType !== 'ALL' && normalizeSettlementType(project.settlementType) !== filters.settlementType) return false;
  return filters.department === 'ALL' || project.department === filters.department;
}
