import type { CashflowWeekSheet, WeeklySubmissionStatus } from '../data/types';

export type WeeklyExpenseSyncState = 'idle' | 'pending' | 'review_required' | 'synced' | 'sync_failed';

export interface WeeklyAccountingSnapshot {
  projectionEdited: boolean;
  projectionDone: boolean;
  expenseEdited: boolean;
  expenseDone: boolean;
  expenseSyncState: WeeklyExpenseSyncState;
  expenseReviewPendingCount: number;
  pmSubmitted: boolean;
  adminClosed: boolean;
}

export interface WeeklyAccountingState {
  projectionDone: boolean;
  expenseDone: boolean;
  expenseSyncState: WeeklyExpenseSyncState;
  expenseReviewPendingCount: number;
  closeDialogKind: 'prerequisite' | 'warning' | 'confirm';
  expenseStatusLabel: string;
  expenseStatusDescription: string;
  expenseStatusTone: 'muted' | 'warning' | 'danger' | 'success';
}

function hasWeekAmounts(values: Record<string, unknown> | undefined): boolean {
  if (!values) return false;
  return Object.values(values).some((value) => typeof value === 'number' && Number.isFinite(value) && value !== 0);
}

export function resolveWeeklyAccountingSnapshot(
  status: WeeklySubmissionStatus | null | undefined,
  weekSheet?: CashflowWeekSheet | null,
): WeeklyAccountingSnapshot {
  const projectionHasData = hasWeekAmounts(weekSheet?.projection);
  const actualHasData = hasWeekAmounts(weekSheet?.actual);
  const expenseSyncState = (
    status?.expenseSyncState
    || (actualHasData ? 'pending' : 'idle')
  ) as WeeklyExpenseSyncState;
  const expenseDone = typeof status?.expenseUpdated === 'boolean'
    ? status.expenseUpdated
    : (actualHasData || expenseSyncState !== 'idle');
  return {
    projectionEdited: typeof status?.projectionEdited === 'boolean'
      ? status.projectionEdited
      : projectionHasData,
    projectionDone: typeof status?.projectionUpdated === 'boolean'
      ? status.projectionUpdated
      : (projectionHasData || Boolean(weekSheet?.pmSubmitted) || Boolean(weekSheet?.adminClosed)),
    expenseEdited: typeof status?.expenseEdited === 'boolean'
      ? status.expenseEdited
      : actualHasData,
    expenseDone,
    expenseSyncState,
    expenseReviewPendingCount: Math.max(0, Math.trunc(status?.expenseReviewPendingCount || 0)),
    pmSubmitted: Boolean(weekSheet?.pmSubmitted),
    adminClosed: Boolean(weekSheet?.adminClosed),
  };
}

export function resolveWeeklyAccountingState(
  status: WeeklySubmissionStatus | null | undefined,
  weekSheet?: CashflowWeekSheet | null,
): WeeklyAccountingState {
  const snapshot = resolveWeeklyAccountingSnapshot(status, weekSheet);
  const { projectionDone, expenseDone, expenseSyncState, expenseReviewPendingCount } = snapshot;

  if (!projectionDone || !expenseDone) {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'prerequisite',
      expenseStatusLabel: expenseDone ? '저장됨' : '미완료',
      expenseStatusDescription: expenseDone ? '정산대장은 저장되었지만 제출/동기화 확인이 더 필요합니다.' : '사업비 입력이 아직 제출 완료 상태가 아닙니다.',
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
      expenseStatusDescription: '수식 후보값이 남아 있어 영수증/증빙 기준으로 다시 확인해야 합니다.',
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
      expenseStatusDescription: '정산대장은 저장되었지만 캐시플로 실제값 반영이 실패했습니다.',
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
      expenseStatusDescription: '정산대장은 저장되었고, 캐시플로 실제값 반영을 기다리는 상태입니다.',
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
    expenseStatusDescription: '정산대장과 캐시플로 실제값이 일치하는 상태입니다.',
    expenseStatusTone: 'success',
  };
}
