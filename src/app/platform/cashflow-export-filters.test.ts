import { describe, expect, it } from 'vitest';
import type { AccountType } from '../data/types';
import { filterCashflowExportTargetProjects } from './cashflow-export-filters';

function project(id: string, accountType: AccountType, department: string) {
  return { id, accountType, department };
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
        accountTypeFilter: 'OPERATING',
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
        accountTypeFilter: 'DEDICATED',
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
});
