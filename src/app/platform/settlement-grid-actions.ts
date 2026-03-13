import type { ImportRow } from './settlement-csv';

export interface GridSelectionBounds {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

export const PROTECTED_SETTLEMENT_CLEAR_HEADERS = [
  'No.',
  '실제 구비 완료된 증빙자료 리스트',
  '준비필요자료',
  '증빙자료 드라이브',
  '준비 필요자료',
] as const;

export function buildProtectedClearColumnIndexes(
  columns: Array<{ csvHeader: string }>,
  extraProtectedHeaders: string[] = [],
): Set<number> {
  const protectedHeaders = new Set<string>([
    ...PROTECTED_SETTLEMENT_CLEAR_HEADERS,
    ...extraProtectedHeaders,
  ]);
  return new Set(
    columns
      .map((column, index) => (protectedHeaders.has(column.csvHeader) ? index : -1))
      .filter((index) => index >= 0),
  );
}

export function clearSelectedImportCells(
  rows: ImportRow[],
  bounds: GridSelectionBounds,
  protectedColumnIndexes: Set<number>,
): ImportRow[] {
  return rows.map((row, rowIdx) => {
    if (rowIdx < bounds.r1 || rowIdx > bounds.r2) return row;
    const nextCells = [...row.cells];
    let changed = false;
    for (let colIdx = bounds.c1; colIdx <= bounds.c2; colIdx += 1) {
      if (colIdx < 0 || colIdx >= nextCells.length) continue;
      if (protectedColumnIndexes.has(colIdx)) continue;
      if (nextCells[colIdx] === '') continue;
      nextCells[colIdx] = '';
      changed = true;
    }
    return changed ? { ...row, cells: nextCells } : row;
  });
}

export function clearAllImportCells(
  rows: ImportRow[],
  protectedColumnIndexes: Set<number>,
): ImportRow[] {
  return rows.map((row) => {
    const nextCells = row.cells.map((cell, colIdx) => (
      protectedColumnIndexes.has(colIdx) ? cell : ''
    ));
    const changed = nextCells.some((cell, index) => cell !== row.cells[index]);
    return changed ? { ...row, cells: nextCells } : row;
  });
}

export function removeSelectedImportRows(
  rows: ImportRow[],
  bounds: GridSelectionBounds,
): ImportRow[] {
  return rows.filter((_, rowIdx) => rowIdx < bounds.r1 || rowIdx > bounds.r2);
}
