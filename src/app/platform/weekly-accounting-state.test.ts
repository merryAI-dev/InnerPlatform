import { describe, expect, it } from 'vitest';
import {
  resolveWeeklyAccountingSheetRowsHydration,
  resolveWeeklyAccountingProductStatus,
  resolveWeeklyAccountingProductStatusDomHooks,
  resolveWeeklyAccountingSnapshot,
  resolveWeeklyAccountingState,
  serializeWeeklyAccountingImportRowsMaterially,
} from './weekly-accounting-state';

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
    expect(state.expenseStatusDescription).toContain('끝났');
  });

  it('exposes a persistent save-pending product status before expense save completes', () => {
    const status = resolveWeeklyAccountingProductStatus({
      snapshot: {
        projectionEdited: true,
        projectionDone: true,
        expenseEdited: true,
        expenseDone: false,
        expenseSyncState: 'idle',
        expenseReviewPendingCount: 0,
        pmSubmitted: false,
        adminClosed: false,
      },
    });

    expect(status.kind).toBe('save_pending');
    expect(status.label).toBe('저장 전 초안');
    expect(status.description).toContain('기준본');
    expect(status.tone).toBe('warning');
  });

  it('treats pending sync as save-synced with persistent text', () => {
    const status = resolveWeeklyAccountingProductStatus({
      snapshot: {
        projectionEdited: true,
        projectionDone: true,
        expenseEdited: true,
        expenseDone: true,
        expenseSyncState: 'pending',
        expenseReviewPendingCount: 0,
        pmSubmitted: false,
        adminClosed: false,
      },
    });

    expect(status.kind).toBe('save_synced');
    expect(status.label).toBe('저장 완료');
    expect(status.description).toContain('실제값 반영');
    expect(status.tone).toBe('warning');
    expect(status.auditTitle).toBe('최종 동기화 대기 반영');
  });

  it('keeps review-required wording stable and count aware', () => {
    const status = resolveWeeklyAccountingProductStatus({
      snapshot: {
        projectionEdited: true,
        projectionDone: true,
        expenseEdited: true,
        expenseDone: true,
        expenseSyncState: 'review_required',
        expenseReviewPendingCount: 3,
        pmSubmitted: false,
        adminClosed: false,
      },
    });

    expect(status.kind).toBe('review_required');
    expect(status.label).toBe('사람 확인 3건');
    expect(status.description).toContain('증빙');
    expect(status.auditTitle).toBe('최종 사람 확인 상태 반영');
  });

  it('reports sync failure as a persistent danger state', () => {
    const status = resolveWeeklyAccountingProductStatus({
      snapshot: {
        projectionEdited: true,
        projectionDone: true,
        expenseEdited: true,
        expenseDone: true,
        expenseSyncState: 'sync_failed',
        expenseReviewPendingCount: 0,
        pmSubmitted: false,
        adminClosed: false,
      },
    });

    expect(status.kind).toBe('sync_failed');
    expect(status.label).toBe('동기화 실패');
    expect(status.description).toContain('다시 확인');
    expect(status.tone).toBe('danger');
  });

  it('exposes stable DOM hooks for product status assertions', () => {
    const status = resolveWeeklyAccountingProductStatus({
      snapshot: {
        projectionEdited: true,
        projectionDone: true,
        expenseEdited: true,
        expenseDone: true,
        expenseSyncState: 'synced',
        expenseReviewPendingCount: 0,
        pmSubmitted: false,
        adminClosed: false,
      },
    });
    const hooks = resolveWeeklyAccountingProductStatusDomHooks(status);

    expect(hooks.testId).toBe('weekly-accounting-product-status-save_synced');
    expect(hooks.ariaLabel).toBe('주간 정산 상태: 동기화 완료');
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

  it('keeps pending sync state stable across a persistence echo with only row identity changes', () => {
    const currentRows = [{
      tempId: 'local-1',
      sourceTxId: 'tx-1',
      cells: ['A', '100'],
      reviewHints: ['사람 확인'],
      reviewRequiredCellIndexes: [1],
      reviewStatus: 'pending' as const,
      reviewFingerprint: 'fingerprint',
      reviewConfirmedAt: '2026-04-01T00:00:00Z',
      userEditedCells: new Set([0]),
    }];
    const incomingRows = [{
      tempId: 'remote-9',
      sourceTxId: 'tx-1',
      cells: ['A', '100'],
      reviewHints: ['사람 확인'],
      reviewRequiredCellIndexes: [1],
      reviewStatus: 'pending' as const,
      reviewFingerprint: 'fingerprint',
      reviewConfirmedAt: '2026-04-01T00:00:00Z',
    }];

    const result = resolveWeeklyAccountingSheetRowsHydration({
      reason: 'persistence_echo',
      currentRows,
      incomingRows,
      incomingRowsOrigin: 'persisted',
      currentSaveState: 'saved',
      currentSyncState: 'pending',
    });

    expect(serializeWeeklyAccountingImportRowsMaterially(currentRows)).toBe(serializeWeeklyAccountingImportRowsMaterially(incomingRows));
    expect(result.shouldReplaceRows).toBe(false);
    expect(result.nextSaveState).toBe('saved');
    expect(result.nextSyncState).toBe('pending');
  });

  it('treats an unchanged active-sheet hydrate as a semantic refresh instead of preserving stale sync state', () => {
    const result = resolveWeeklyAccountingSheetRowsHydration({
      reason: 'active_sheet_switch_hydrate',
      currentRows: [],
      incomingRows: [],
      incomingRowsOrigin: 'fallback',
      currentSaveState: 'pending',
      currentSyncState: 'sync_failed',
    });

    expect(result.shouldReplaceRows).toBe(false);
    expect(result.nextSaveState).toBe('idle');
    expect(result.nextSyncState).toBe('idle');
  });

  it('does not replace dirty local weekly rows with an unrelated hydrate echo', () => {
    const result = resolveWeeklyAccountingSheetRowsHydration({
      reason: 'active_sheet_switch_hydrate',
      currentRows: [{ tempId: 'local-1', cells: ['지급처', '120,000'] }],
      incomingRows: [{ tempId: 'persisted-1', cells: ['지급처', '100,000'] }],
      incomingRowsOrigin: 'persisted',
      currentSaveState: 'dirty',
      currentSyncState: 'pending',
    });

    expect(result.shouldReplaceRows).toBe(false);
    expect(result.nextSaveState).toBe('dirty');
    expect(result.nextSyncState).toBe('pending');
  });
});
