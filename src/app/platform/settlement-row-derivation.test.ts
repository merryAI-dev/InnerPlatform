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

  it('can ignore explicit balance anchors during authoritative replay', () => {
    const row1Cells = createCells();
    row1Cells[11] = '100,000';
    row1Cells[9] = '100,000';
    const row2Cells = createCells();
    row2Cells[13] = '30,000';
    row2Cells[9] = '999,999';

    const next = deriveSettlementRows(
      [createRow(row1Cells), createRow(row2Cells)],
      context,
      { mode: 'full', respectExplicitBalanceAnchors: false },
    );

    expect(next[0]?.cells[9]).toBe('100,000');
    expect(next[1]?.cells[9]).toBe('70,000');
  });

  it('derives vatIn from expense amount when both bank and expense amounts are present', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000'; // bankAmount
    rowCells[13] = '100,000'; // expenseAmount — user entered
    const next = deriveSettlementRows([createRow(rowCells)], context, { mode: 'row', rowIdx: 0 });

    expect(next[0]?.cells[13]).toBe('100,000'); // expenseAmount preserved
    expect(next[0]?.cells[14]).toBe('10,000');  // vatIn auto-calculated
  });

  it('derives expense from bank amount before recalculating balance', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000';
    rowCells[14] = '10,000';
    const next = deriveSettlementRows([createRow(rowCells)], context, { mode: 'cascade', rowIdx: 0 });

    expect(next[0]?.cells[13]).toBe('100,000');
    expect(next[0]?.cells[9]).toBe('-110,000');
  });

  it('derives supply-amount candidates from bank amount and marks vat as human review', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000';
    const row: ImportRow = {
      tempId: 'supply-amount-candidate',
      sourceTxId: 'bank:row-1',
      cells: rowCells,
    };
    const next = deriveSettlementRows([row], { ...context, basis: '공급가액' }, { mode: 'cascade', rowIdx: 0 });

    expect(next[0]?.cells[13]).toBe('100,000');
    expect(next[0]?.cells[14]).toBe('10,000');
    expect(next[0]?.reviewHints).toEqual(['매입부가세 후보값입니다. 증빙 기준 금액으로 다시 확인해 주세요.']);
    expect(next[0]?.reviewRequiredCellIndexes).toEqual([14]);
    expect(next[0]?.reviewStatus).toBe('pending');
    expect(next[0]?.reviewFingerprint).toBeTruthy();
  });

  it('preserves confirmed review status while the candidate values stay the same', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000';
    const first = deriveSettlementRows([
      {
        tempId: 'confirmed-review-row',
        sourceTxId: 'bank:confirmed-1',
        cells: rowCells,
      },
    ], { ...context, basis: '공급가액' }, { mode: 'cascade', rowIdx: 0 })[0];

    const confirmed: ImportRow = {
      ...(first as ImportRow),
      reviewStatus: 'confirmed',
      reviewConfirmedAt: '2026-04-04T04:00:00.000Z',
    };
    const next = deriveSettlementRows([confirmed], { ...context, basis: '공급가액' }, { mode: 'cascade', rowIdx: 0 });

    expect(next[0]?.reviewStatus).toBe('confirmed');
    expect(next[0]?.reviewConfirmedAt).toBe('2026-04-04T04:00:00.000Z');
  });

  it('resets confirmed review status when the candidate values change', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000';
    const first = deriveSettlementRows([
      {
        tempId: 'confirmed-review-reset-row',
        sourceTxId: 'bank:confirmed-2',
        cells: rowCells,
      },
    ], { ...context, basis: '공급가액' }, { mode: 'cascade', rowIdx: 0 })[0];

    const changedCells = [...(first?.cells || createCells())];
    changedCells[10] = '220,000';
    const changed: ImportRow = {
      ...(first as ImportRow),
      cells: changedCells,
      reviewStatus: 'confirmed',
      reviewConfirmedAt: '2026-04-04T04:10:00.000Z',
    };
    const next = deriveSettlementRows([changed], { ...context, basis: '공급가액' }, { mode: 'cascade', rowIdx: 0 });

    expect(next[0]?.reviewFingerprint).not.toBe(first?.reviewFingerprint);
    expect(next[0]?.reviewStatus).toBe('pending');
    expect(next[0]?.reviewConfirmedAt).toBeUndefined();
  });

  it('does not split deposit rows into expense and vat candidates', () => {
    const rowCells = createCells();
    rowCells[10] = '5,000';
    rowCells[11] = '5,000,000';
    const row: ImportRow = {
      tempId: 'deposit-row',
      sourceTxId: 'bank:deposit-1',
      cells: rowCells,
    };
    const next = deriveSettlementRows([row], { ...context, basis: '공급가액' }, { mode: 'cascade', rowIdx: 0 });

    expect(next[0]?.cells[13]).toBe('');
    expect(next[0]?.cells[14]).toBe('');
    expect(next[0]?.reviewHints).toBeUndefined();
  });

  it('keeps a cleared expense amount empty when the user explicitly cleared it', () => {
    const rowCells = createCells();
    rowCells[10] = '110,000';
    rowCells[15] = 'CMK 임팩트프러너';
    const row: ImportRow = {
      tempId: 'manual-clear-row',
      cells: rowCells,
      userEditedCells: new Set([13]),
    };

    const next = deriveSettlementRows([row], context, { mode: 'cascade', rowIdx: 0 });

    expect(next[0]?.cells[13]).toBe('');
    expect(next[0]?.cells[10]).toBe('110,000');
  });

  it('derives adjustment rows from the entered balance anchor', () => {
    const firstCells = createCells();
    firstCells[11] = '100,000';
    const adjustmentCells = createCells();
    adjustmentCells[9] = '70,000';
    adjustmentCells[25] = '잔액 보정';

    const adjustmentRow: ImportRow = {
      tempId: 'adjustment-row',
      entryKind: 'ADJUSTMENT',
      cells: adjustmentCells,
    };

    const next = deriveSettlementRows([createRow(firstCells), adjustmentRow], context, { mode: 'cascade', rowIdx: 0 });

    expect(next[1]?.cells[13]).toBe('30,000');
    expect(next[1]?.cells[10]).toBe('30,000');
    expect(next[1]?.cells[9]).toBe('70,000');
  });
});
