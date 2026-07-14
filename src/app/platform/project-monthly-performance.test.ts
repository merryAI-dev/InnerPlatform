import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { buildProjectMonthlyPerformance } from './project-monthly-performance';

const project = {
  id: 'project-1',
  contractAmount: 100_000,
  totalRevenueAmount: 25_000,
  executiveReviewHistory: [],
} as unknown as Project;

describe('buildProjectMonthlyPerformance', () => {
  it('uses the latest approved project log within the current KST year through the current month', () => {
    const months = buildProjectMonthlyPerformance([
      { ...project, id: 'history', executiveReviewHistory: [{ status: 'APPROVED', reviewedAt: '2026-07-01T00:30:00.000Z' }] },
      { ...project, id: 'field', contractAmount: 200_000, totalRevenueAmount: 50_000, executiveReviewedAt: '2026-06-30T16:30:00.000Z' },
      { ...project, id: 'unapproved', contractAmount: 999_000, totalRevenueAmount: 999_000 },
    ], new Date('2026-07-14T00:00:00.000Z'));

    expect(months).toHaveLength(7);
    expect(months[0]?.key).toBe('2026-01');
    expect(months[6]).toMatchObject({ key: '2026-07', contractAmount: 300_000, totalRevenueAmount: 75_000 });
    expect(months[5]).toMatchObject({ key: '2026-06', contractAmount: 0, totalRevenueAmount: 0 });
  });
});
