import { describe, expect, it } from 'vitest';
import {
  chunkCashflowExportProjectIds,
  findCashflowExportSettlementStatus,
  resolveCashflowExportRecentWeeks,
} from './cashflow-export-dashboard';

describe('cashflow export operations dashboard', () => {
  it.each([
    ['2026-08-26', [['2026-08', 4], ['2026-08', 5]]],
    ['2026-08-31', [['2026-08', 4], ['2026-08', 5]]],
    ['2026-09-01', [['2026-08', 5], ['2026-09', 1]]],
    ['2027-01-01', [['2026-12', 5], ['2027-01', 1]]],
  ])('selects the previous and current finance week for %s', (todayIso, expected) => {
    expect(resolveCashflowExportRecentWeeks(todayIso).map(({ yearMonth, weekNo }) => [yearMonth, weekNo]))
      .toEqual(expected);
  });

  it('returns no weeks for an invalid Seoul date', () => {
    expect(resolveCashflowExportRecentWeeks('not-a-date')).toEqual([]);
  });

  it('chunks the maximum BFF request size without dropping the 101st project', () => {
    const projectIds = Array.from({ length: 101 }, (_, index) => `p${index + 1}`);
    expect(chunkCashflowExportProjectIds(projectIds).map((chunk) => chunk.length)).toEqual([100, 1]);
    expect(chunkCashflowExportProjectIds([])).toEqual([]);
  });

  it('joins a status only by exact project, month, and week period', () => {
    const recentWeeks = resolveCashflowExportRecentWeeks('2026-09-01');
    const results = [{
      projectId: 'project-a',
      yearMonth: '2026-08',
      items: [{
        period: 'WEEK_5' as const,
        status: 'COMPLETED' as const,
        submittedAt: '2026-08-31T01:00:00.000Z', submittedBy: 'pm-1',
        approvedAt: '2026-08-31T02:00:00.000Z', approvedBy: 'head-1', revision: 2,
      }],
    }, {
      projectId: 'project-a',
      yearMonth: '2026-09',
      items: [{
        period: 'WEEK_1' as const,
        status: 'PENDING_APPROVAL' as const,
        submittedAt: '2026-09-01T01:00:00.000Z', submittedBy: 'pm-1',
        approvedAt: '', approvedBy: '', revision: 1,
      }],
    }];

    expect(findCashflowExportSettlementStatus(results, 'project-a', recentWeeks[0])?.status).toBe('COMPLETED');
    expect(findCashflowExportSettlementStatus(results, 'project-a', recentWeeks[1])?.status).toBe('PENDING_APPROVAL');
    expect(findCashflowExportSettlementStatus(results, 'project-b', recentWeeks[0])).toBeNull();
    expect(findCashflowExportSettlementStatus([
      { ...results[0], projectId: 'project-b' },
      { ...results[1], yearMonth: '2026-08' },
    ], 'project-a', recentWeeks[1])).toBeNull();
  });

  it('fails closed instead of choosing between duplicate status identities', () => {
    const [week] = resolveCashflowExportRecentWeeks('2026-08-31');
    const status = {
      period: week.period,
      status: 'COMPLETED' as const,
      submittedAt: '2026-08-25T01:00:00.000Z', submittedBy: 'pm-1',
      approvedAt: '2026-08-25T02:00:00.000Z', approvedBy: 'head-1', revision: 2,
    };
    expect(findCashflowExportSettlementStatus([
      { projectId: 'project-a', yearMonth: week.yearMonth, items: [status, { ...status }] },
    ], 'project-a', week)).toBeNull();
  });
});
