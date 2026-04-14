import type { AccountType } from '../data/types';

export type CashflowExportProjectScope = 'all' | 'single';
export type CashflowExportAccountTypeFilter = 'ALL' | AccountType;

export interface CashflowExportProjectLike {
  id: string;
  accountType: AccountType;
}

export interface CashflowExportProjectFilterParams {
  scope: CashflowExportProjectScope;
  selectedProjectId?: string;
  accountTypeFilter: CashflowExportAccountTypeFilter;
}

export function filterCashflowExportTargetProjects<T extends CashflowExportProjectLike>(
  projects: readonly T[],
  params: CashflowExportProjectFilterParams,
): T[] {
  const scopedProjects = params.scope === 'single'
    ? projects.filter((project) => project.id === params.selectedProjectId)
    : [...projects];

  if (params.accountTypeFilter === 'ALL') {
    return scopedProjects;
  }

  return scopedProjects.filter((project) => project.accountType === params.accountTypeFilter);
}
