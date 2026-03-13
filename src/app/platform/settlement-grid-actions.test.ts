import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import {
  buildProtectedClearColumnIndexes,
  clearAllImportCells,
  clearSelectedImportCells,
  removeSelectedImportRows,
} from './settlement-grid-actions';

function createRow(tempId: string, cells: string[]): ImportRow {
  return { tempId, cells };
}

describe('settlement-grid-actions', () => {
  it('clears only selected editable cells', () => {
    const rows = [
      createRow('r1', ['1', 'A', 'drive-1', 'memo-1']),
      createRow('r2', ['2', 'B', 'drive-2', 'memo-2']),
    ];
    const protectedIndexes = buildProtectedClearColumnIndexes([
      { csvHeader: 'No.' },
      { csvHeader: '지급처' },
      { csvHeader: '증빙자료 드라이브' },
      { csvHeader: '상세 적요' },
    ]);

    const next = clearSelectedImportCells(rows, { r1: 0, r2: 1, c1: 1, c2: 3 }, protectedIndexes);

    expect(next[0]?.cells).toEqual(['1', '', 'drive-1', '']);
    expect(next[1]?.cells).toEqual(['2', '', 'drive-2', '']);
  });

  it('clears all row values but preserves protected columns', () => {
    const rows = [
      createRow('r1', ['1', '2026-03-01', 'drive-link', 'memo']),
    ];
    const protectedIndexes = buildProtectedClearColumnIndexes([
      { csvHeader: 'No.' },
      { csvHeader: '거래일시' },
      { csvHeader: '증빙자료 드라이브' },
      { csvHeader: '상세 적요' },
    ]);

    const next = clearAllImportCells(rows, protectedIndexes);

    expect(next[0]?.cells).toEqual(['1', '', 'drive-link', '']);
  });

  it('removes all selected rows in one shot', () => {
    const rows = [
      createRow('r1', ['1']),
      createRow('r2', ['2']),
      createRow('r3', ['3']),
      createRow('r4', ['4']),
    ];

    const next = removeSelectedImportRows(rows, { r1: 1, r2: 2, c1: 0, c2: 0 });

    expect(next.map((row) => row.tempId)).toEqual(['r1', 'r4']);
  });
});
