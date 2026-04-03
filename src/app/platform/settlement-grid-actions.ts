import type { ImportRow } from './settlement-csv';

export interface SettlementSelectionBounds {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

export const DEFAULT_PROTECTED_SETTLEMENT_HEADERS = [
  'No.',
  '필수증빙자료 리스트',
  '실제 구비 완료된 증빙자료 리스트',
  '준비필요자료',
  '증빙자료 드라이브',
  '준비 필요자료',
] as const;

function normalizeBounds(
  rows: ImportRow[],
  bounds: SettlementSelectionBounds | null,
): SettlementSelectionBounds | null {
  if (!bounds || rows.length === 0) return null;
  const r1 = Math.max(0, Math.min(rows.length - 1, bounds.r1));
  const r2 = Math.max(0, Math.min(rows.length - 1, bounds.r2));
  if (r1 > r2) return null;
  return {
    r1,
    r2,
    c1: Math.max(0, Math.min(bounds.c1, bounds.c2)),
    c2: Math.max(0, Math.max(bounds.c1, bounds.c2)),
  };
}

export function clearSelectionCells(
  rows: ImportRow[],
  bounds: SettlementSelectionBounds | null,
  options?: {
    protectedColumnIndexes?: number[];
  },
): ImportRow[] {
  const normalized = normalizeBounds(rows, bounds);
  if (!normalized) return rows;
  const protectedColumns = new Set(options?.protectedColumnIndexes || []);
  let changed = false;
  const next = rows.map((row, rowIdx) => {
    if (rowIdx < normalized.r1 || rowIdx > normalized.r2) return row;
    let rowChanged = false;
    const cells = [...row.cells];
    const userEditedCells = new Set(row.userEditedCells || []);
    for (let colIdx = normalized.c1; colIdx <= normalized.c2; colIdx += 1) {
      if (protectedColumns.has(colIdx)) continue;
      if (colIdx >= cells.length) continue;
      if (cells[colIdx] === '') continue;
      cells[colIdx] = '';
      userEditedCells.add(colIdx);
      rowChanged = true;
    }
    if (!rowChanged) return row;
    changed = true;
    return { ...row, cells, userEditedCells };
  });
  return changed ? next : rows;
}

export function deleteSelectedRows(
  rows: ImportRow[],
  bounds: SettlementSelectionBounds | null,
): ImportRow[] {
  const normalized = normalizeBounds(rows, bounds);
  if (!normalized) return rows;
  return rows.filter((_, rowIdx) => rowIdx < normalized.r1 || rowIdx > normalized.r2);
}

export function clearAllEditableCells(
  rows: ImportRow[],
  options?: {
    protectedColumnIndexes?: number[];
  },
): ImportRow[] {
  if (rows.length === 0) return rows;
  const protectedColumns = new Set(options?.protectedColumnIndexes || []);
  let changed = false;
  const next = rows.map((row) => {
    let rowChanged = false;
    const cells = [...row.cells];
    const userEditedCells = new Set(row.userEditedCells || []);
    for (let colIdx = 0; colIdx < cells.length; colIdx += 1) {
      if (protectedColumns.has(colIdx)) continue;
      if (cells[colIdx] === '') continue;
      cells[colIdx] = '';
      userEditedCells.add(colIdx);
      rowChanged = true;
    }
    if (!rowChanged) return row;
    changed = true;
    return { ...row, cells, userEditedCells };
  });
  return changed ? next : rows;
}
