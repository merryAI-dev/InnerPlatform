import type { AccountType } from '../data/types';

export type CashflowExportProjectScope = 'all' | 'single' | 'selected';
export type CashflowExportAccountTypeFilter = 'ALL' | AccountType;

export interface CashflowExportProjectLike {
  id: string;
  accountType: AccountType;
  department?: string;
}

export interface CashflowExportProjectFilterParams {
  scope: CashflowExportProjectScope;
  selectedProjectId?: string;
  selectedProjectIds?: string[];
  departmentFilter?: string;
  accountTypeFilter: CashflowExportAccountTypeFilter;
}

export function filterCashflowExportTargetProjects<T extends CashflowExportProjectLike>(
  projects: readonly T[],
  params: CashflowExportProjectFilterParams,
): T[] {
  const selectedProjectIds = new Set(params.selectedProjectIds || []);
  const scopedProjects = params.scope === 'single'
    ? projects.filter((project) => project.id === params.selectedProjectId)
    : params.scope === 'selected'
      ? projects.filter((project) => selectedProjectIds.has(project.id))
      : [...projects];

  const organizationProjects = params.departmentFilter && params.departmentFilter !== 'ALL'
    ? scopedProjects.filter((project) => project.department === params.departmentFilter)
    : scopedProjects;

  if (params.accountTypeFilter === 'ALL') {
    return organizationProjects;
  }

  return organizationProjects.filter((project) => project.accountType === params.accountTypeFilter);
}
