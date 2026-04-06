import type { CashflowWeekSheet, WeeklySubmissionStatus } from '../data/types';
import type { ImportRow } from './settlement-csv';
import { countPendingImportRowReviews } from './settlement-review';

export type WeeklyExpenseSyncState = 'idle' | 'pending' | 'review_required' | 'synced' | 'sync_failed';
export type WeeklyAccountingSheetRowsHydrationReason =
  | 'initial_hydrate'
  | 'active_sheet_switch_hydrate'
  | 'explicit_revert'
  | 'persistence_echo';
export type WeeklyAccountingSheetRowsSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'save_failed';
export type WeeklyAccountingSheetRowsSyncState = WeeklyExpenseSyncState | 'syncing';
export type WeeklyAccountingProductStatusKind =
  | 'save_pending'
  | 'save_synced'
  | 'review_required'
  | 'sync_failed'
  | 'save_failed';

export interface WeeklyAccountingProductStatus {
  kind: WeeklyAccountingProductStatusKind;
  label: string;
  description: string;
  tone: 'muted' | 'warning' | 'danger' | 'success';
  auditTitle: string;
}

export interface WeeklyAccountingProductStatusDomHooks {
  testId: string;
  ariaLabel: string;
}

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

export interface WeeklyAccountingImportRowLike {
  tempId?: string;
  sourceTxId?: string;
  entryKind?: ImportRow['entryKind'];
  cells: string[];
  error?: string;
  reviewHints?: string[];
  reviewRequiredCellIndexes?: number[];
  reviewStatus?: ImportRow['reviewStatus'];
  reviewFingerprint?: string;
  reviewConfirmedAt?: string;
  userEditedCells?: Set<number>;
}

export interface WeeklyAccountingSheetRowsHydrationInput {
  reason: WeeklyAccountingSheetRowsHydrationReason;
  currentRows: WeeklyAccountingImportRowLike[] | null | undefined;
  incomingRows: WeeklyAccountingImportRowLike[] | null | undefined;
  incomingRowsOrigin?: 'persisted' | 'fallback';
  currentSaveState: WeeklyAccountingSheetRowsSaveState;
  currentSyncState: WeeklyAccountingSheetRowsSyncState;
}

export interface WeeklyAccountingSheetRowsHydrationResult {
  shouldReplaceRows: boolean;
  nextSaveState: WeeklyAccountingSheetRowsSaveState;
  nextSyncState: WeeklyAccountingSheetRowsSyncState;
  currentSignature: string;
  incomingSignature: string;
}

export interface WeeklyAccountingProductStatusInput {
  snapshot: WeeklyAccountingSnapshot;
  saveState?: 'idle' | 'dirty' | 'saving' | 'saved' | 'save_failed';
  syncState?: 'idle' | 'pending' | 'syncing' | 'synced' | 'review_required' | 'sync_failed';
  reviewCount?: number;
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

function formatReviewCountLabel(count: number): string {
  return count > 0 ? `사람 확인 ${count}건` : '사람 확인 필요';
}

function toNonNegativeCount(value: number | undefined): number {
  return Math.max(0, Math.trunc(value || 0));
}

function normalizeStringList(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean))).sort();
}

function normalizeNumberList(values: number[] | undefined): number[] {
  return Array.from(new Set((values || []).filter((value) => Number.isInteger(value) && value >= 0))).sort((left, right) => left - right);
}

export function serializeWeeklyAccountingImportRowsMaterially(
  rows: WeeklyAccountingImportRowLike[] | null | undefined,
): string {
  if (!rows || rows.length === 0) return '';
  return JSON.stringify(rows.map((row) => ({
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: Array.isArray(row.cells) ? row.cells.map((cell) => String(cell ?? '')) : [],
    ...(row.error ? { error: row.error } : {}),
    ...(normalizeStringList(row.reviewHints).length > 0 ? { reviewHints: normalizeStringList(row.reviewHints) } : {}),
    ...(normalizeNumberList(row.reviewRequiredCellIndexes).length > 0
      ? { reviewRequiredCellIndexes: normalizeNumberList(row.reviewRequiredCellIndexes) }
      : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
  })));
}

function deriveHydratedSheetRowsState(
  rows: WeeklyAccountingImportRowLike[] | null | undefined,
  origin: 'persisted' | 'fallback' | undefined,
): {
  saveState: WeeklyAccountingSheetRowsSaveState;
  syncState: WeeklyAccountingSheetRowsSyncState;
} {
  if (origin === 'fallback' || !rows || rows.length === 0) {
    return { saveState: 'idle', syncState: 'idle' };
  }
  return {
    saveState: 'saved',
    syncState: countPendingImportRowReviews(rows) > 0 ? 'review_required' : 'synced',
  };
}

export function resolveWeeklyAccountingSheetRowsHydration(
  input: WeeklyAccountingSheetRowsHydrationInput,
): WeeklyAccountingSheetRowsHydrationResult {
  const currentSignature = serializeWeeklyAccountingImportRowsMaterially(input.currentRows);
  const incomingSignature = serializeWeeklyAccountingImportRowsMaterially(input.incomingRows);
  const materialEqual = currentSignature === incomingSignature;

  if (input.reason === 'persistence_echo') {
    return {
      shouldReplaceRows: !materialEqual,
      nextSaveState: input.currentSaveState,
      nextSyncState: input.currentSyncState,
      currentSignature,
      incomingSignature,
    };
  }

  if (
    input.reason === 'active_sheet_switch_hydrate'
    && (input.currentSaveState === 'dirty' || input.currentSaveState === 'saving')
  ) {
    return {
      shouldReplaceRows: false,
      nextSaveState: input.currentSaveState,
      nextSyncState: input.currentSyncState,
      currentSignature,
      incomingSignature,
    };
  }

  const hydratedState = deriveHydratedSheetRowsState(input.incomingRows, input.incomingRowsOrigin);
  return {
    shouldReplaceRows: !materialEqual,
    nextSaveState: hydratedState.saveState,
    nextSyncState: hydratedState.syncState,
    currentSignature,
    incomingSignature,
  };
}

export function resolveWeeklyAccountingProductStatus(
  input: WeeklyAccountingProductStatusInput,
): WeeklyAccountingProductStatus {
  const reviewCount = toNonNegativeCount(input.reviewCount ?? input.snapshot.expenseReviewPendingCount);
  const syncState = input.syncState ?? input.snapshot.expenseSyncState;
  const saveState = input.saveState;
  const expenseDone = input.snapshot.expenseDone || saveState === 'saved' || syncState === 'synced' || syncState === 'review_required' || syncState === 'sync_failed';

  if (saveState === 'save_failed') {
    return {
      kind: 'save_failed',
      label: '저장 실패',
      description: '입력 내용은 유지되고 있지만 서버 기준본 저장이 끝나지 않았습니다. 같은 화면에서 다시 저장해 주세요.',
      tone: 'danger',
      auditTitle: '최종 저장 실패 반영',
    };
  }

  if (saveState === 'dirty' || saveState === 'saving' || (!expenseDone && saveState !== 'saved')) {
    return {
      kind: 'save_pending',
      label: saveState === 'saving' ? '저장 중' : '저장 전 초안',
      description: saveState === 'saving'
        ? '주간 정산 기준본을 저장하고 있습니다.'
        : '현재 편집 내용은 아직 주간 정산 기준본으로 확정되지 않았습니다.',
      tone: 'warning',
      auditTitle: '최종 저장 대기 반영',
    };
  }

  if (syncState === 'review_required') {
    return {
      kind: 'review_required',
      label: formatReviewCountLabel(reviewCount),
      description: '일부 행은 자동 분류가 끝나지 않았습니다. 영수증과 증빙을 확인한 뒤 사람 확인을 마쳐야 최종 반영됩니다.',
      tone: 'warning',
      auditTitle: '최종 사람 확인 상태 반영',
    };
  }

  if (syncState === 'sync_failed') {
    return {
      kind: 'sync_failed',
      label: '동기화 실패',
      description: '정산대장은 저장되었지만 캐시플로 실제값 반영이 끝나지 않았습니다. 새로고침하지 말고 같은 화면에서 다시 확인해 주세요.',
      tone: 'danger',
      auditTitle: '최종 동기화 실패 반영',
    };
  }

  if (syncState === 'synced') {
    return {
      kind: 'save_synced',
      label: '동기화 완료',
      description: '정산대장 저장과 캐시플로 실제값 반영이 모두 끝났습니다.',
      tone: 'success',
      auditTitle: '최종 동기화 완료 반영',
    };
  }

  if (syncState === 'pending' || syncState === 'syncing' || saveState === 'saved' || expenseDone) {
    return {
      kind: 'save_synced',
      label: '저장 완료',
      description: '정산대장은 저장되었고 캐시플로 실제값 반영을 이어서 처리하는 중입니다.',
      tone: 'warning',
      auditTitle: '최종 동기화 대기 반영',
    };
  }

  return {
    kind: 'save_pending',
    label: '저장 전 초안',
    description: '현재 편집 내용은 아직 주간 정산 기준본으로 확정되지 않았습니다.',
    tone: 'warning',
    auditTitle: '최종 저장 대기 반영',
  };
}

export function resolveWeeklyAccountingProductStatusDomHooks(
  status: WeeklyAccountingProductStatus,
): WeeklyAccountingProductStatusDomHooks {
  return {
    testId: `weekly-accounting-product-status-${status.kind}`,
    ariaLabel: `주간 정산 상태: ${status.label}`,
  };
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
  const productStatus = resolveWeeklyAccountingProductStatus({ snapshot });

  if (!projectionDone || !expenseDone) {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'prerequisite',
      expenseStatusLabel: expenseDone ? productStatus.label : '미완료',
      expenseStatusDescription: expenseDone
        ? productStatus.description
        : '사업비 입력이 아직 제출 완료 상태가 아닙니다.',
      expenseStatusTone: expenseDone ? productStatus.tone : 'danger',
    };
  }

  if (productStatus.kind === 'review_required') {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'warning',
      expenseStatusLabel: productStatus.label,
      expenseStatusDescription: productStatus.description,
      expenseStatusTone: productStatus.tone,
    };
  }

  if (productStatus.kind === 'sync_failed') {
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'warning',
      expenseStatusLabel: productStatus.label,
      expenseStatusDescription: productStatus.description,
      expenseStatusTone: productStatus.tone,
    };
  }

  if (productStatus.kind === 'save_synced') {
    if (expenseSyncState === 'synced') {
      return {
        projectionDone,
        expenseDone,
        expenseSyncState,
        expenseReviewPendingCount,
        closeDialogKind: 'confirm',
        expenseStatusLabel: productStatus.label,
        expenseStatusDescription: productStatus.description,
        expenseStatusTone: productStatus.tone,
      };
    }
    return {
      projectionDone,
      expenseDone,
      expenseSyncState,
      expenseReviewPendingCount,
      closeDialogKind: 'warning',
      expenseStatusLabel: productStatus.label,
      expenseStatusDescription: productStatus.description,
      expenseStatusTone: productStatus.tone,
    };
  }

  return {
    projectionDone,
    expenseDone,
    expenseSyncState,
    expenseReviewPendingCount,
    closeDialogKind: 'confirm',
    expenseStatusLabel: productStatus.label,
    expenseStatusDescription: productStatus.description,
    expenseStatusTone: productStatus.tone,
  };
}
