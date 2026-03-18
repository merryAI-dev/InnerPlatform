import type { ImportRow } from './settlement-csv';

export function updateImportRowAt(
  rows: ImportRow[],
  rowIdx: number,
  updater: (row: ImportRow) => ImportRow,
): ImportRow[] {
  if (rowIdx < 0 || rowIdx >= rows.length) return rows;
  const currentRow = rows[rowIdx];
  if (!currentRow) return rows;
  const nextRow = updater(currentRow);
  if (nextRow === currentRow) return rows;
  const nextRows = rows.slice();
  nextRows[rowIdx] = nextRow;
  return nextRows;
}
