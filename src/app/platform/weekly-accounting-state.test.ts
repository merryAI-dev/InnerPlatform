import { describe, expect, it } from 'vitest';
import { resolveWeeklyAccountingState } from './weekly-accounting-state';

describe('weekly-accounting-state', () => {
  it('requires prerequisite when projection or expense is incomplete', () => {
    expect(resolveWeeklyAccountingState({
      id: 'w1',
      projectId: 'p1',
      yearMonth: '2026-03',
      weekNo: 1,
      projectionUpdated: true,
      expenseUpdated: false,
    }).closeDialogKind).toBe('prerequisite');
  });

  it('returns warning when expense save is done but human review remains', () => {
    const state = resolveWeeklyAccountingState({
      id: 'w1',
      projectId: 'p1',
      yearMonth: '2026-03',
      weekNo: 1,
      projectionUpdated: true,
      expenseUpdated: true,
      expenseSyncState: 'review_required',
      expenseReviewPendingCount: 2,
    });

    expect(state.closeDialogKind).toBe('warning');
    expect(state.expenseStatusLabel).toBe('사람 확인 2건');
  });

  it('returns confirm when both projection and expense are synced cleanly', () => {
    const state = resolveWeeklyAccountingState({
      id: 'w1',
      projectId: 'p1',
      yearMonth: '2026-03',
      weekNo: 1,
      projectionUpdated: true,
      expenseUpdated: true,
      expenseSyncState: 'synced',
    });

    expect(state.closeDialogKind).toBe('confirm');
    expect(state.expenseStatusLabel).toBe('동기화 완료');
  });
});
