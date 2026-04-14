import { describe, expect, it } from 'vitest';
import type { AccountType } from '../data/types';
import { filterCashflowExportTargetProjects } from './cashflow-export-filters';

function project(id: string, accountType: AccountType) {
  return { id, accountType };
}

describe('cashflow-export-filters', () => {
  it('filters all-scope projects by account type', () => {
    const projects = [
      project('p1', 'DEDICATED'),
      project('p2', 'OPERATING'),
      project('p3', 'NONE'),
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
      project('p1', 'DEDICATED'),
      project('p2', 'OPERATING'),
      project('p3', 'NONE'),
    ];

    expect(
      filterCashflowExportTargetProjects(projects, {
        scope: 'single',
        selectedProjectId: 'p3',
        accountTypeFilter: 'DEDICATED',
      }),
    ).toEqual([]);
  });
});
