import type { ImportRow } from '../platform/settlement-csv';
import type { WeeklySubmissionStatus } from './types';

interface ExpenseSheetTabSnapshot {
  id: string;
  name: string;
  order: number;
  rows: ImportRow[];
  createdAt?: string;
  updatedAt?: string;
}

export function serializeExpenseSheetRowForPersistence(row: ImportRow) {
  return {
    tempId: row.tempId || `imp-${Date.now()}`,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: Array.isArray(row.cells) ? row.cells.map((cell) => (cell ?? '')) : [],
    ...(row.error ? { error: row.error } : {}),
    ...(row.reviewHints && row.reviewHints.length > 0 ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes && row.reviewRequiredCellIndexes.length > 0
      ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes].sort((a, b) => a - b) }
      : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(row.userEditedCells && row.userEditedCells.size > 0
      ? { userEditedCellIndexes: Array.from(row.userEditedCells).sort((a, b) => a - b) }
      : {}),
  };
}

export function sanitizeExpenseSheetName(value: string | undefined, fallback: string): string {
  const trimmed = String(value || '').trim().replace(/\s+/g, ' ');
  return trimmed || fallback;
}

export function buildExpenseSheetPersistenceDoc(params: {
  orgId: string;
  projectId: string;
  activeSheetId: string;
  activeSheetName: string;
  order: number;
  rows: ImportRow[];
  now: string;
  updatedBy: string;
  createdAt?: string;
}) {
  return {
    tenantId: params.orgId,
    id: params.activeSheetId,
    projectId: params.projectId,
    name: sanitizeExpenseSheetName(params.activeSheetName, params.activeSheetId === 'default' ? '기본 탭' : '새 탭'),
    order: params.order,
    rows: params.rows.map(serializeExpenseSheetRowForPersistence),
    createdAt: params.createdAt || params.now,
    updatedAt: params.now,
    updatedBy: params.updatedBy,
  };
}

export function upsertExpenseSheetTabRows(params: {
  sheets: ExpenseSheetTabSnapshot[];
  sheetId: string;
  sheetName: string;
  order: number;
  rows: ImportRow[];
  now: string;
  createdAt?: string;
}): ExpenseSheetTabSnapshot[] {
  const nextSheet: ExpenseSheetTabSnapshot = {
    id: params.sheetId,
    name: sanitizeExpenseSheetName(params.sheetName, params.sheetId === 'default' ? '기본 탭' : '새 탭'),
    order: params.order,
    rows: params.rows,
    createdAt: params.createdAt || params.now,
    updatedAt: params.now,
  };
  const nextSheets = [...params.sheets];
  const index = nextSheets.findIndex((sheet) => sheet.id === params.sheetId);
  if (index >= 0) {
    nextSheets[index] = nextSheet;
  } else {
    nextSheets.push(nextSheet);
  }
  return nextSheets.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return String(left.createdAt || left.updatedAt || '').localeCompare(String(right.createdAt || right.updatedAt || ''));
  });
}

export function buildWeeklySubmissionStatusPatch(params: {
  orgId: string;
  projectId: string;
  yearMonth: string;
  weekNo: number;
  updatedBy: string;
  now: string;
  projectionEdited?: boolean;
  projectionUpdated?: boolean;
  expenseEdited?: boolean;
  expenseUpdated?: boolean;
  expenseSyncState?: 'pending' | 'review_required' | 'synced' | 'sync_failed';
  expenseReviewPendingCount?: number;
}): WeeklySubmissionStatus {
  const patch: WeeklySubmissionStatus = {
    id: `${params.projectId}-${params.yearMonth}-w${params.weekNo}`,
    tenantId: params.orgId,
    projectId: params.projectId,
    yearMonth: params.yearMonth,
    weekNo: params.weekNo,
    updatedAt: params.now,
    updatedByName: params.updatedBy,
  };

  if (typeof params.projectionEdited === 'boolean') {
    patch.projectionEdited = params.projectionEdited;
    patch.projectionEditedAt = params.now;
    patch.projectionEditedByName = params.updatedBy;
  }
  if (typeof params.projectionUpdated === 'boolean') {
    patch.projectionUpdated = params.projectionUpdated;
    patch.projectionUpdatedAt = params.now;
    patch.projectionUpdatedByName = params.updatedBy;
  }
  if (typeof params.expenseEdited === 'boolean') {
    patch.expenseEdited = params.expenseEdited;
    patch.expenseEditedAt = params.now;
    patch.expenseEditedByName = params.updatedBy;
  }
  if (typeof params.expenseUpdated === 'boolean') {
    patch.expenseUpdated = params.expenseUpdated;
    patch.expenseUpdatedAt = params.now;
    patch.expenseUpdatedByName = params.updatedBy;
  }
  if (
    params.expenseSyncState === 'pending'
    || params.expenseSyncState === 'review_required'
    || params.expenseSyncState === 'synced'
    || params.expenseSyncState === 'sync_failed'
  ) {
    patch.expenseSyncState = params.expenseSyncState;
    patch.expenseSyncUpdatedAt = params.now;
    patch.expenseSyncUpdatedByName = params.updatedBy;
  }
  if (typeof params.expenseReviewPendingCount === 'number' && Number.isFinite(params.expenseReviewPendingCount)) {
    patch.expenseReviewPendingCount = Math.max(0, Math.trunc(params.expenseReviewPendingCount));
  }
  return patch;
}
