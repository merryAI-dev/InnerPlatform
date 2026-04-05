import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import {
  resolveSettlementFlowSnapshot,
  type SettlementFlowAmountIndexes,
} from './settlement-flow-amounts';

function createEmptyCells(): string[] {
  return Array.from({ length: 27 }, () => '');
}

function createRow(cells: string[], partial?: Partial<ImportRow>): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2)}`,
    cells,
    ...partial,
  };
}

const indexes: SettlementFlowAmountIndexes = {
  cashflowIdx: 8,
  bankAmountIdx: 10,
  depositIdx: 11,
  refundIdx: 12,
  expenseAmountIdx: 13,
  vatInIdx: 14,
};

describe('resolveSettlementFlowSnapshot', () => {
  it('marks bank-imported outflow rows as manual pending until human input is complete', () => {
    const cells = createEmptyCells();
    cells[8] = '직접사업비';
    cells[10] = '110,000';
    const snapshot = resolveSettlementFlowSnapshot(createRow(cells, {
      sourceTxId: 'bank:expense-1',
      entryKind: 'EXPENSE',
    }), indexes);

    expect(snapshot.manualOutflowPending).toBe(true);
    expect(snapshot.cashflowActualLineAmounts).toEqual({});
    expect(snapshot.budgetActualAmount).toBe(0);
  });

  it('uses human-entered outflow split once expense amount is present', () => {
    const cells = createEmptyCells();
    cells[8] = '직접사업비';
    cells[10] = '110,000';
    cells[13] = '100,000';
    cells[14] = '10,000';
    const snapshot = resolveSettlementFlowSnapshot(createRow(cells, {
      sourceTxId: 'bank:expense-1',
      entryKind: 'EXPENSE',
    }), indexes);

    expect(snapshot.manualOutflowPending).toBe(false);
    expect(snapshot.cashflowActualLineAmounts).toEqual({
      DIRECT_COST_OUT: 100000,
      INPUT_VAT_OUT: 10000,
    });
    expect(snapshot.budgetActualAmount).toBe(100000);
  });

  it('keeps inflow rows on the inflow side', () => {
    const cells = createEmptyCells();
    cells[8] = '매출액(입금)';
    cells[11] = '250,000';
    const snapshot = resolveSettlementFlowSnapshot(createRow(cells), indexes);

    expect(snapshot.manualOutflowPending).toBe(false);
    expect(snapshot.cashflowActualLineAmounts).toEqual({ SALES_IN: 250000 });
    expect(snapshot.budgetActualAmount).toBe(0);
  });
});
