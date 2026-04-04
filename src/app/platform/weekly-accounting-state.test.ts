import { describe, expect, it } from 'vitest';
import { resolveWeeklyAccountingSnapshot, resolveWeeklyAccountingState } from './weekly-accounting-state';

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
    expect(state.expenseStatusDescription).toContain('증빙');
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
    expect(state.expenseStatusDescription).toContain('일치');
  });

  it('derives effective done state from persisted week sheet data when manual flags are absent', () => {
    const snapshot = resolveWeeklyAccountingSnapshot(undefined, {
      id: 'w1',
      projectId: 'p1',
      yearMonth: '2026-03',
      weekNo: 1,
      weekStart: '2026-03-02',
      weekEnd: '2026-03-08',
      projection: { SALES_IN: 100000 },
      actual: { DIRECT_COST_OUT: 30000 },
      pmSubmitted: true,
      adminClosed: false,
      createdAt: '2026-03-02T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
    });

    expect(snapshot.projectionEdited).toBe(true);
    expect(snapshot.projectionDone).toBe(true);
    expect(snapshot.expenseEdited).toBe(true);
    expect(snapshot.expenseDone).toBe(true);
    expect(snapshot.expenseSyncState).toBe('pending');
  });
});
