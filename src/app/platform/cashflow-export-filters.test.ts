import { describe, expect, it } from 'vitest';
import type { AccountType } from '../data/types';
import * as cashflowExportFilters from './cashflow-export-filters';

const { filterCashflowExportTargetProjects } = cashflowExportFilters;

function project(id: string, accountType: AccountType, department: string, name = id) {
  return { id, accountType, department, name };
}

describe('cashflow-export-filters', () => {
  it('filters all-scope projects by account type', () => {
    const projects = [
      project('p1', 'DEDICATED', 'CIC1'),
      project('p2', 'OPERATING', 'CIC2'),
      project('p3', 'NONE', '개발협력센터'),
    ];

    expect(
      filterCashflowExportTargetProjects(projects, {
        scope: 'all',
        accountTypeFilter: ['OPERATING'],
      }),
    ).toEqual([projects[1]]);
  });

  it('filters the selected project by account type in single scope', () => {
    const projects = [
      project('p1', 'DEDICATED', 'CIC1'),
      project('p2', 'OPERATING', 'CIC2'),
      project('p3', 'NONE', '개발협력센터'),
    ];

    expect(
      filterCashflowExportTargetProjects(projects, {
        scope: 'single',
        selectedProjectId: 'p3',
        accountTypeFilter: ['DEDICATED'],
      }),
    ).toEqual([]);
  });

  it('filters by organization and several explicitly selected projects', () => {
    const projects = [
      project('p1', 'DEDICATED', 'CIC1'),
      project('p2', 'OPERATING', 'CIC1'),
      project('p3', 'NONE', '개발협력센터'),
    ];

    expect(
      filterCashflowExportTargetProjects(projects, {
        scope: 'selected',
        selectedProjectIds: ['p1', 'p3'],
        departmentFilter: 'CIC1',
        accountTypeFilter: 'ALL',
      }),
    ).toEqual([projects[0]]);
  });

  it('filters by several account types including OTHER', () => {
    const projects = [
      project('p1', 'DEDICATED', 'CIC1'),
      project('p2', 'OPERATING', 'CIC1'),
      project('p3', 'NONE', 'CIC1'),
      project('p4', 'OTHER', 'CIC1'),
    ];

    expect(
      filterCashflowExportTargetProjects(projects, {
        scope: 'all',
        accountTypeFilter: ['DEDICATED', 'OTHER'],
      }),
    ).toEqual([projects[0], projects[3]]);
  });

  it('keeps ALL distinct from an explicit empty account type selection', () => {
    const projects = [project('p1', 'DEDICATED', 'CIC1')];

    expect(filterCashflowExportTargetProjects(projects, {
      scope: 'all',
      accountTypeFilter: 'ALL',
    })).toEqual(projects);
    expect(filterCashflowExportTargetProjects(projects, {
      scope: 'all',
      accountTypeFilter: [],
    })).toEqual([]);
  });

  it('toggles from ALL to an explicit list and preserves an explicit empty selection', () => {
    expect(typeof (cashflowExportFilters as Record<string, unknown>).toggleCashflowExportAccountType).toBe('function');
    const toggleCashflowExportAccountType = (
      cashflowExportFilters as unknown as {
        toggleCashflowExportAccountType: (
          current: 'ALL' | AccountType[],
          accountType: 'ALL' | AccountType,
        ) => 'ALL' | AccountType[];
      }
    ).toggleCashflowExportAccountType;

    expect(toggleCashflowExportAccountType('ALL', 'OTHER')).toEqual(['OTHER']);
    expect(toggleCashflowExportAccountType(['OTHER'], 'DEDICATED')).toEqual(['OTHER', 'DEDICATED']);
    expect(toggleCashflowExportAccountType(['OTHER'], 'OTHER')).toEqual([]);
    expect(toggleCashflowExportAccountType([], 'ALL')).toBe('ALL');
  });

  it('sorts department-first with project name and id tie-breakers', () => {
    const projects = [
      project('p3', 'NONE', '센터B', '가 사업'),
      project('p2', 'NONE', '센터A', '나 사업'),
      project('p1', 'NONE', '센터A', '가 사업'),
      project('p0', 'NONE', '센터A', '가 사업'),
    ];

    expect(filterCashflowExportTargetProjects(projects, {
      scope: 'all',
      accountTypeFilter: 'ALL',
      sortBy: 'DEPARTMENT',
    }).map(({ id }) => id)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('expands every contract year instead of relying on a hardcoded 2024 option', () => {
    expect(typeof (cashflowExportFilters as Record<string, unknown>).buildCashflowExportAvailableYears).toBe('function');
    const buildCashflowExportAvailableYears = (
      cashflowExportFilters as unknown as {
        buildCashflowExportAvailableYears: (
          projects: Array<{ contractStart: string; contractEnd: string }>,
          currentYear: string,
        ) => string[];
      }
    ).buildCashflowExportAvailableYears;

    expect(buildCashflowExportAvailableYears([
      { contractStart: '2023-09-01', contractEnd: '2026-02-28' },
      { contractStart: '2028-01-01', contractEnd: '2028-12-31' },
    ], '2027')).toEqual(['2023', '2024', '2025', '2026', '2027', '2028']);
  });
});
