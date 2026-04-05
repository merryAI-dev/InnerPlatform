import type { MonthMondayWeek } from './cashflow-weeks';
import type { ImportRow } from './settlement-csv';
import type { SettlementDerivationContext, SettlementDerivationOptions } from './settlement-row-derivation';
import type { SettlementActualSyncWeekPayload } from './settlement-sheet-sync';

export interface KernelImportRowJson {
  tempId: string;
  sourceTxId?: string;
  entryKind?: string;
  cells: string[];
  error?: string;
  reviewHints?: string[];
  reviewRequiredCellIndexes?: number[];
  reviewStatus?: 'pending' | 'confirmed';
  reviewFingerprint?: string;
  reviewConfirmedAt?: string;
  userEditedCells?: number[];
}

export interface SettlementKernelDeriveRequest {
  rows: KernelImportRowJson[];
  context: SettlementDerivationContext;
  options: SettlementDerivationOptions;
}

export interface SettlementKernelDeriveResponse {
  rows: KernelImportRowJson[];
}

export interface SettlementKernelActualSyncRequest {
  command: 'actualSync';
  rows: KernelImportRowJson[];
  yearWeeks: MonthMondayWeek[];
  persistedRows?: KernelImportRowJson[];
}

export interface SettlementKernelActualSyncResponse {
  weeks: SettlementActualSyncWeekPayload[];
}

export function serializeImportRowsForKernel(rows: ImportRow[]): KernelImportRowJson[] {
  return rows.map((row) => ({
    tempId: row.tempId,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: [...row.cells],
    ...(row.error ? { error: row.error } : {}),
    ...(row.reviewHints ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes] } : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(row.userEditedCells ? { userEditedCells: Array.from(row.userEditedCells).sort((a, b) => a - b) } : {}),
  }));
}

export function deserializeImportRowsFromKernel(rows: KernelImportRowJson[]): ImportRow[] {
  return rows.map((row) => ({
    tempId: row.tempId,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind as ImportRow['entryKind'] } : {}),
    cells: [...row.cells],
    ...(row.error ? { error: row.error } : {}),
    ...(row.reviewHints ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes] } : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(row.userEditedCells ? { userEditedCells: new Set(row.userEditedCells) } : {}),
  }));
}
