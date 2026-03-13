import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import { updateImportRowAt } from './settlement-grid-state';

function createRow(label: string): ImportRow {
  return {
    tempId: `row-${label}`,
    cells: [label],
  };
}

describe('updateImportRowAt', () => {
  it('updates only the targeted row and preserves the others by reference', () => {
    const first = createRow('A');
    const second = createRow('B');
    const rows = [first, second];

    const next = updateImportRowAt(rows, 1, (row) => ({
      ...row,
      cells: ['B2'],
    }));

    expect(next).not.toBe(rows);
    expect(next[0]).toBe(first);
    expect(next[1]).not.toBe(second);
    expect(next[1]?.cells[0]).toBe('B2');
  });

  it('returns the original array when the updater returns the same row reference', () => {
    const rows = [createRow('A')];
    const next = updateImportRowAt(rows, 0, (row) => row);
    expect(next).toBe(rows);
  });

  it('returns the original array when the target index is out of range', () => {
    const rows = [createRow('A')];
    expect(updateImportRowAt(rows, -1, (row) => row)).toBe(rows);
    expect(updateImportRowAt(rows, 3, (row) => row)).toBe(rows);
  });
});
