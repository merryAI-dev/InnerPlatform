import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { groupProjectListItems, matchesProjectListFilters } from './project-list-view';

const baseProject = {
  id: 'project-a',
  name: '농식품 창업',
  officialContractName: '2026 농식품 액셀러레이팅',
  clientOrg: '한국농업기술진흥원',
  department: 'C-스템CIC',
  managerName: '메리',
  teamMembersDetailed: [],
  status: 'IN_PROGRESS',
  phase: 'CONFIRMED',
  settlementType: 'TYPE1',
} as unknown as Project;

describe('project list view', () => {
  it('groups contract-pending projects by status even when their phase is confirmed', () => {
    const contractPending = { ...baseProject, id: 'pending', status: 'CONTRACT_PENDING', phase: 'CONFIRMED' } as Project;
    const prospectInProgress = { ...baseProject, id: 'in-progress', status: 'IN_PROGRESS', phase: 'PROSPECT' } as Project;

    const grouped = groupProjectListItems([contractPending, prospectInProgress]);

    expect(grouped.contractPending.map((project) => project.id)).toEqual(['pending']);
    expect(grouped.registered.map((project) => project.id)).toEqual(['in-progress']);
  });

  it('combines settlement type, status, department, and text filters', () => {
    expect(matchesProjectListFilters(baseProject, {
      search: '농식품',
      status: 'IN_PROGRESS',
      settlementType: 'TYPE1',
      department: 'C-스템CIC',
    })).toBe(true);
    expect(matchesProjectListFilters(baseProject, {
      search: '농식품',
      status: 'IN_PROGRESS',
      settlementType: 'TYPE2',
      department: 'C-스템CIC',
    })).toBe(false);
  });
});
