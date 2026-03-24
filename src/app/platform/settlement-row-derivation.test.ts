import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import { deriveSettlementRows, isSettlementCascadeColumn, type SettlementDerivationContext } from './settlement-row-derivation';

function createCells(): string[] {
  return Array.from({ length: 26 }, () => '');
}

function createRow(cells: string[]): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2)}`,
    cells,
  };
}

const context: SettlementDerivationContext = {
  projectId: 'p1',
  defaultLedgerId: 'l1',
  dateIdx: 2,
  weekIdx: 3,
  depositIdx: 11,
  refundIdx: 12,
  expenseIdx: 13,
  vatInIdx: 14,
  bankAmountIdx: 10,
  balanceIdx: 9,
  evidenceIdx: 17,
  evidenceCompletedIdx: 18,
  evidencePendingIdx: 19,
};

describe('settlement-row-derivation', () => {
  it('marks only financial columns as cascade-sensitive', () => {
    expect(isSettlementCascadeColumn(11, context)).toBe(true);
    expect(isSettlementCascadeColumn(9, context)).toBe(true);
    expect(isSettlementCascadeColumn(15, context)).toBe(false);
  });

  it('recomputes only the edited row for row-local changes', () => {
    const first = createRow(createCells().map((cell, index) => (index === 15 ? 'A' : cell)));
    const secondCells = createCells();
    secondCells[17] = '세금계산서, 이체확인증';
    secondCells[18] = '세금계산서';
    const second = createRow(secondCells);
    const next = deriveSettlementRows([first, second], context, { mode: 'row', rowIdx: 1 });

    expect(next[0]).toBe(first);
    expect(next[1]).not.toBe(second);
    expect(next[1]?.cells[19]).toBe('이체확인증');
  });

  it('recomputes downstream balances for cascade changes', () => {
    const row1Cells = createCells();
    row1Cells[11] = '100,000';
    const row2Cells = createCells();
    row2Cells[13] = '30,000';
    const row3Cells = createCells();
    row3Cells[13] = '10,000';

    const rows = [createRow(row1Cells), createRow(row2Cells), createRow(row3Cells)];
    rows[1].cells[13] = '40,000';

    const next = deriveSettlementRows(rows, context, { mode: 'cascade', rowIdx: 1 });

    expect(next[0]).toBe(rows[0]);
    expect(next[1]?.cells[9]).toBe('60,000');
    expect(next[2]?.cells[9]).toBe('50,000');
  });

  it('preserves explicit balances when present', () => {
    const row1Cells = createCells();
    row1Cells[11] = '100,000';
    row1Cells[9] = '100,000';
    const row2Cells = createCells();
    row2Cells[13] = '30,000';
    row2Cells[9] = '70,000';

    const rows = [createRow(row1Cells), createRow(row2Cells)];
    rows[1].cells[13] = '40,000';

    const next = deriveSettlementRows(rows, context, { mode: 'cascade', rowIdx: 1 });

    expect(next[1]?.cells[9]).toBe('70,000');
  });

  it('overwrites existing expense amount when bank amount is present', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000'; // bankAmount
    rowCells[14] = '10,000';  // vatIn
    rowCells[13] = '999,999'; // existing expenseAmount — should be overwritten
    const next = deriveSettlementRows([createRow(rowCells)], context, { mode: 'row', rowIdx: 0 });

    expect(next[0]?.cells[13]).toBe('100,000');
  });

  it('derives expense from bank amount before recalculating balance', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000';
    rowCells[14] = '10,000';
    const next = deriveSettlementRows([createRow(rowCells)], context, { mode: 'cascade', rowIdx: 0 });

    expect(next[0]?.cells[13]).toBe('100,000');
    expect(next[0]?.cells[9]).toBe('-110,000');
  });
});
