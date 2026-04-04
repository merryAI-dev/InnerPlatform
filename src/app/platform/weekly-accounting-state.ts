import type { WeeklySubmissionStatus } from '../data/types';

export type WeeklyExpenseSyncState = 'idle' | 'pending' | 'review_required' | 'synced' | 'sync_failed';

export interface WeeklyAccountingState {
  projectionDone: boolean;
  expenseDone: boolean;
  expenseSyncState: WeeklyExpenseSyncState;
  expenseReviewPendingCount: number;
  closeDialogKind: 'prerequisite' | 'warning' | 'confirm';
  expenseStatusLabel: string;
  expenseStatusTone: 'muted' | 'warning' | 'danger' | 'success';
}

export function resolveWeeklyAccountingState(
  status: WeeklySubmissionStatus | null | undefined,
): WeeklyAccountingState {
  const projectionDone = Boolean(status?.projectionUpdated);
  const expenseDone = Boolean(status?.expenseUpdated);
  const expenseSyncState = (status?.expenseSyncState || 'idle') as WeeklyExpenseSyncState;
  const expenseReviewPendingCount = Math.max(0, Math.trunc(status?.expenseReviewPendingCount || 0));

  if (!projectionDone || !expenseDone) {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'prerequisite',
      expenseStatusLabel: expenseDone ? '저장됨' : '미완료',
      expenseStatusTone: expenseDone ? 'muted' : 'danger',
    };
  }

  if (expenseSyncState === 'review_required') {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'warning',
      expenseStatusLabel: expenseReviewPendingCount > 0
        ? `사람 확인 ${expenseReviewPendingCount}건`
        : '사람 확인 필요',
      expenseStatusTone: 'warning',
    };
  }

  if (expenseSyncState === 'sync_failed') {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'warning',
      expenseStatusLabel: '동기화 실패',
      expenseStatusTone: 'danger',
    };
  }

  if (expenseSyncState === 'pending' || expenseSyncState === 'idle') {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'warning',
      expenseStatusLabel: '동기화 대기',
      expenseStatusTone: 'warning',
    };
  }

  return {
    projectionDone,
    expenseDone,
    expenseSyncState,
    expenseReviewPendingCount,
    closeDialogKind: 'confirm',
    expenseStatusLabel: '동기화 완료',
    expenseStatusTone: 'success',
  };
}
