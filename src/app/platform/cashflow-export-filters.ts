import type { AccountType } from '../data/types';

export type CashflowExportProjectScope = 'all' | 'single' | 'selected';
export type CashflowExportAccountTypeFilter = 'ALL' | AccountType[];
export type CashflowExportSortBy = 'PROJECT_NAME' | 'DEPARTMENT';

export interface CashflowExportProjectLike {
  id: string;
  name: string;
  accountType: AccountType;
  department?: string;
}

export interface CashflowExportProjectFilterParams {
  scope: CashflowExportProjectScope;
  selectedProjectId?: string;
  selectedProjectIds?: string[];
  departmentFilter?: string;
  accountTypeFilter: CashflowExportAccountTypeFilter;
  sortBy?: CashflowExportSortBy;
}

export function toggleCashflowExportAccountType(
  current: CashflowExportAccountTypeFilter,
  accountType: 'ALL' | AccountType,
): CashflowExportAccountTypeFilter {
  if (accountType === 'ALL') return 'ALL';
  const selected = current === 'ALL' ? [] : current;
  return selected.includes(accountType)
    ? selected.filter((value) => value !== accountType)
    : [...selected, accountType];
}

function compareProjectName(left: CashflowExportProjectLike, right: CashflowExportProjectLike): number {
  const nameOrder = left.name.localeCompare(right.name, 'ko');
  return nameOrder || left.id.localeCompare(right.id);
}

function compareDepartment(left: CashflowExportProjectLike, right: CashflowExportProjectLike): number {
  const departmentOrder = String(left.department || '').localeCompare(String(right.department || ''), 'ko');
  return departmentOrder || compareProjectName(left, right);
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

  const accountTypeProjects = params.accountTypeFilter === 'ALL'
    ? organizationProjects
    : organizationProjects.filter((project) => params.accountTypeFilter.includes(project.accountType));

  const compare = params.sortBy === 'DEPARTMENT' ? compareDepartment : compareProjectName;
  return [...accountTypeProjects].sort(compare);
}

function readContractYear(value?: string): number | null {
  const match = /^(\d{4})(?:-|$)/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

export function buildCashflowExportAvailableYears(
  projects: ReadonlyArray<{ contractStart?: string; contractEnd?: string }>,
  currentYear: string,
): string[] {
  const years = new Set<number>();
  const current = readContractYear(currentYear);
  if (current !== null) years.add(current);

  for (const project of projects) {
    const start = readContractYear(project.contractStart);
    const end = readContractYear(project.contractEnd);
    if (start === null && end === null) continue;
    if (start === null || end === null) {
      const availableYear = start ?? end;
      if (availableYear !== null) years.add(availableYear);
      continue;
    }
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    for (let year = low; year <= high; year += 1) years.add(year);
  }

  return Array.from(years).sort((left, right) => left - right).map(String);
}
