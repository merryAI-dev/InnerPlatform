import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { groupProjectListItems, matchesProjectListFilters, summarizeProjectListItems } from './project-list-view';

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
  it('groups active projects into contract-pending, in-progress, and completed tabs', () => {
    const contractPending = { ...baseProject, id: 'pending', status: 'CONTRACT_PENDING', phase: 'CONFIRMED' } as Project;
    const prospectInProgress = { ...baseProject, id: 'in-progress', status: 'IN_PROGRESS', phase: 'PROSPECT' } as Project;
    const completed = { ...baseProject, id: 'completed', status: 'COMPLETED' } as Project;
    const pendingPayment = { ...baseProject, id: 'pending-payment', status: 'COMPLETED_PENDING_PAYMENT' } as Project;

    const grouped = groupProjectListItems([contractPending, prospectInProgress, completed, pendingPayment]);

    expect(grouped.contractPending.map((project) => project.id)).toEqual(['pending']);
    expect(grouped.inProgress.map((project) => project.id)).toEqual(['in-progress']);
    expect(grouped.completed.map((project) => project.id)).toEqual(['completed', 'pending-payment']);
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

  it('summarizes only active projects with registered contract and total revenue values', () => {
    const summary = summarizeProjectListItems([
      { ...baseProject, id: 'pending', status: 'CONTRACT_PENDING', contractAmount: 100_000, totalRevenueAmount: 25_000 } as Project,
      { ...baseProject, id: 'in-progress', status: 'IN_PROGRESS', contractAmount: 200_000, totalRevenueAmount: 50_000 } as Project,
      { ...baseProject, id: 'completed', status: 'COMPLETED', contractAmount: 300_000, totalRevenueAmount: 75_000 } as Project,
      { ...baseProject, id: 'trashed', status: 'COMPLETED', contractAmount: 999_000, totalRevenueAmount: 999_000, trashedAt: '2026-07-14' } as Project,
    ]);

    expect(summary).toMatchObject({
      total: 3,
      contractPending: 1,
      inProgress: 1,
      completed: 1,
      contractAmount: 600_000,
      totalRevenueAmount: 150_000,
    });
  });
});
