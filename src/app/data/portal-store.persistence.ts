import {
  createEmptyImportRow,
  getCashflowLineLabelForExport,
  SETTLEMENT_COLUMNS,
  type ImportRow,
} from '../platform/settlement-csv';
import { findWeekForDate, getYearMondayWeeks } from '../platform/cashflow-weeks';
import { resolveEvidenceChecklist } from '../platform/evidence-helpers';
import { resolveBankImportCashflowLineId } from '../platform/bank-import-cashflow';
import type { BankImportIntakeItem, EvidenceStatus, WeeklySubmissionStatus } from './types';

interface ExpenseSheetTabSnapshot {
  id: string;
  name: string;
  order: number;
  rows: ImportRow[];
  createdAt?: string;
  updatedAt?: string;
}

function findColumnIndex(header: string): number {
  return SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
}

function buildProjectionRowFromIntake(
  item: BankImportIntakeItem,
  existingRow?: ImportRow | null,
  evidenceRequiredDesc?: string,
): ImportRow {
  const base = existingRow ? {
    ...existingRow,
    cells: Array.isArray(existingRow.cells)
      ? SETTLEMENT_COLUMNS.map((_, index) => String(existingRow.cells[index] ?? ''))
      : SETTLEMENT_COLUMNS.map(() => ''),
  } : createEmptyImportRow();
  const cells = [...base.cells];
  const dateIdx = findColumnIndex('거래일시');
  const weekIdx = findColumnIndex('해당 주차');
  const budgetIdx = findColumnIndex('비목');
  const subBudgetIdx = findColumnIndex('세목');
  const cashflowIdx = findColumnIndex('cashflow항목');
  const balanceIdx = findColumnIndex('통장잔액');
  const bankAmountIdx = findColumnIndex('통장에 찍힌 입/출금액');
  const depositIdx = findColumnIndex('입금액(사업비,공급가액,은행이자)');
  const expenseIdx = findColumnIndex('사업비 사용액');
  const counterpartyIdx = findColumnIndex('지급처');
  const memoIdx = findColumnIndex('상세 적요');
  const completedIdx = findColumnIndex('실제 구비 완료된 증빙자료 리스트');
  const pendingIdx = findColumnIndex('준비필요자료');
  const requiredIdx = findColumnIndex('필수증빙자료 리스트');
  const evidenceChecklist = resolveEvidenceChecklist({
    evidenceRequiredDesc,
    evidenceCompletedDesc: item.manualFields.evidenceCompletedDesc || '',
    evidenceCompletedManualDesc: item.manualFields.evidenceCompletedDesc || '',
    evidenceAutoListedDesc: '',
    evidenceDriveLink: '',
    evidenceDriveFolderId: '',
  });

  const dateOnly = String(item.bankSnapshot.dateTime || '').slice(0, 10);
  if (dateIdx >= 0) cells[dateIdx] = dateOnly;
  if (weekIdx >= 0 && dateOnly) {
    const year = Number.parseInt(dateOnly.slice(0, 4), 10);
    const weeks = getYearMondayWeeks(Number.isFinite(year) ? year : new Date().getFullYear());
    cells[weekIdx] = findWeekForDate(dateOnly, weeks)?.label || '';
  }
  if (budgetIdx >= 0) cells[budgetIdx] = item.manualFields.budgetCategory || '';
  if (subBudgetIdx >= 0) cells[subBudgetIdx] = item.manualFields.budgetSubCategory || '';
  if (cashflowIdx >= 0) {
    cells[cashflowIdx] = getCashflowLineLabelForExport(
      resolveBankImportCashflowLineId(item.manualFields, item.bankSnapshot.signedAmount),
    );
  }
  if (balanceIdx >= 0) {
    cells[balanceIdx] = Number.isFinite(item.bankSnapshot.balanceAfter)
      ? item.bankSnapshot.balanceAfter.toLocaleString('ko-KR')
      : '';
  }
  if (bankAmountIdx >= 0) {
    cells[bankAmountIdx] = Number.isFinite(item.bankSnapshot.signedAmount)
      ? Math.abs(item.bankSnapshot.signedAmount).toLocaleString('ko-KR')
      : '';
  }
  if (depositIdx >= 0) {
    cells[depositIdx] = item.bankSnapshot.signedAmount > 0
      ? Math.abs(item.bankSnapshot.signedAmount).toLocaleString('ko-KR')
      : '';
  }
  if (expenseIdx >= 0) {
    cells[expenseIdx] = Number.isFinite(item.manualFields.expenseAmount)
      ? Number(item.manualFields.expenseAmount).toLocaleString('ko-KR')
      : '';
  }
  if (counterpartyIdx >= 0) cells[counterpartyIdx] = item.bankSnapshot.counterparty || '';
  if (memoIdx >= 0) cells[memoIdx] = item.manualFields.memo || item.bankSnapshot.memo || '';
  if (requiredIdx >= 0) cells[requiredIdx] = evidenceRequiredDesc || '';
  if (completedIdx >= 0) cells[completedIdx] = item.manualFields.evidenceCompletedDesc || '';
  if (pendingIdx >= 0) cells[pendingIdx] = evidenceChecklist.missing.join(', ');

  const noIdx = findColumnIndex('No.');
  const projectedRow: ImportRow = {
    ...base,
    tempId: existingRow?.tempId || `bank-${item.bankFingerprint}`,
    sourceTxId: item.sourceTxId,
    entryKind: item.bankSnapshot.signedAmount >= 0 ? 'DEPOSIT' : 'EXPENSE',
    cells,
    userEditedCells: new Set([
      budgetIdx,
      subBudgetIdx,
      cashflowIdx,
      expenseIdx,
      memoIdx,
      completedIdx,
    ].filter((index) => index >= 0)),
    reviewHints: [],
    reviewRequiredCellIndexes: [],
    reviewStatus: undefined,
    reviewFingerprint: undefined,
    reviewConfirmedAt: undefined,
  };
  return projectedRow;
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

export function upsertExpenseSheetProjectionRowBySourceTxId(params: {
  rows: ImportRow[] | null | undefined;
  item: BankImportIntakeItem;
  evidenceRequiredDesc?: string;
}) {
  const currentRows = Array.isArray(params.rows) ? [...params.rows] : [];
  const targetIndex = currentRows.findIndex((row) => String(row.sourceTxId || '').trim() === params.item.sourceTxId);
  const existingRow = targetIndex >= 0 ? currentRows[targetIndex] : null;
  const projectedRow = buildProjectionRowFromIntake(params.item, existingRow, params.evidenceRequiredDesc);
  const nextRows = [...currentRows];
  if (targetIndex >= 0) {
    nextRows[targetIndex] = projectedRow;
  } else {
    nextRows.push(projectedRow);
  }
  const noIdx = findColumnIndex('No.');
  if (noIdx >= 0) {
    nextRows.forEach((row, index) => {
      row.cells[noIdx] = String(index + 1);
    });
  }
  return {
    rows: nextRows,
    projectedRow,
  };
}

export function patchExpenseSheetProjectionEvidenceBySourceTxId(params: {
  rows: ImportRow[] | null | undefined;
  sourceTxId: string;
  evidenceRequiredDesc: string;
  evidenceCompletedDesc: string;
  evidenceStatus: EvidenceStatus;
}) {
  const currentRows = Array.isArray(params.rows) ? [...params.rows] : [];
  const targetIndex = currentRows.findIndex((row) => String(row.sourceTxId || '').trim() === params.sourceTxId);
  if (targetIndex < 0) {
    return {
      rows: currentRows,
      patchedRow: null,
    };
  }

  const row = currentRows[targetIndex];
  const cells = [...row.cells];
  const requiredIdx = findColumnIndex('필수증빙자료 리스트');
  const completedIdx = findColumnIndex('실제 구비 완료된 증빙자료 리스트');
  const pendingIdx = findColumnIndex('준비필요자료');
  const checklist = resolveEvidenceChecklist({
    evidenceRequiredDesc: params.evidenceRequiredDesc,
    evidenceCompletedDesc: params.evidenceCompletedDesc,
    evidenceCompletedManualDesc: params.evidenceCompletedDesc,
    evidenceAutoListedDesc: '',
    evidenceDriveLink: '',
    evidenceDriveFolderId: '',
  });

  if (requiredIdx >= 0) cells[requiredIdx] = params.evidenceRequiredDesc;
  if (completedIdx >= 0) cells[completedIdx] = params.evidenceCompletedDesc;
  if (pendingIdx >= 0) cells[pendingIdx] = checklist.missing.join(', ');

  const patchedRow: ImportRow = {
    ...row,
    cells,
  };
  currentRows[targetIndex] = patchedRow;

  return {
    rows: currentRows,
    patchedRow,
  };
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
