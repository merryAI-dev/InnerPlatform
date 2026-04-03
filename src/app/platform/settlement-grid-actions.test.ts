import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import {
  clearAllEditableCells,
  clearSelectionCells,
  deleteSelectedRows,
} from './settlement-grid-actions';

function createRow(label: string, cells: string[]): ImportRow {
  return {
    tempId: `row-${label}`,
    cells,
  };
}

describe('settlement-grid-actions', () => {
  it('clears only editable cells inside the selected bounds', () => {
    const rows = [
      createRow('a', ['1', '작성자', 'A', 'Drive', '완료']),
      createRow('b', ['2', '작성자2', 'B', 'Drive2', '완료2']),
    ];

    const next = clearSelectionCells(rows, { r1: 0, r2: 1, c1: 0, c2: 4 }, {
      protectedColumnIndexes: [0, 3],
    });

    expect(next).not.toBe(rows);
    expect(next[0]?.cells).toEqual(['1', '', '', 'Drive', '']);
    expect(next[1]?.cells).toEqual(['2', '', '', 'Drive2', '']);
    expect(Array.from(next[0]?.userEditedCells || [])).toEqual([1, 2, 4]);
    expect(Array.from(next[1]?.userEditedCells || [])).toEqual([1, 2, 4]);
  });

  it('preserves references when nothing can be cleared', () => {
    const first = createRow('a', ['1', '', '', 'Drive']);
    const rows = [first];

    const next = clearSelectionCells(rows, { r1: 0, r2: 0, c1: 0, c2: 3 }, {
      protectedColumnIndexes: [0, 3],
    });

    expect(next).toBe(rows);
    expect(next[0]).toBe(first);
  });

  it('deletes all rows inside the selected row range', () => {
    const rows = [
      createRow('a', ['1']),
      createRow('b', ['2']),
      createRow('c', ['3']),
      createRow('d', ['4']),
    ];

    const next = deleteSelectedRows(rows, { r1: 1, r2: 2, c1: 1, c2: 3 });

    expect(next.map((row) => row.cells[0])).toEqual(['1', '4']);
  });

  it('clears all editable cells while preserving protected columns', () => {
    const rows = [
      createRow('a', ['1', '작성자', '10,000', 'Drive']),
      createRow('b', ['2', '작성자2', '', 'Drive2']),
    ];

    const next = clearAllEditableCells(rows, {
      protectedColumnIndexes: [0, 3],
    });

    expect(next[0]?.cells).toEqual(['1', '', '', 'Drive']);
    expect(next[1]?.cells).toEqual(['2', '', '', 'Drive2']);
    expect(Array.from(next[0]?.userEditedCells || [])).toEqual([1, 2]);
    expect(Array.from(next[1]?.userEditedCells || [])).toEqual([1]);
  });
});
