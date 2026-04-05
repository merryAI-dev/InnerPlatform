import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import { aggregateBudgetActualsFromSettlementRows, getTotalBudgetActualFromSettlementRows } from './budget-actuals';

function createEmptyCells(): string[] {
  return Array.from({ length: 27 }, () => '');
}

function createRow(cells: string[]): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2)}`,
    cells,
  };
}

describe('budget-actuals from settlement rows', () => {
  it('uses expense amount for direct-cost rows and groups by budget key', () => {
    const cells = createEmptyCells();
    cells[5] = '회의비';
    cells[6] = '다과비';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';
    const result = aggregateBudgetActualsFromSettlementRows([createRow(cells)]);

    expect(result.get('회의비|다과비')).toBe(30000);
  });

  it('uses vat amount for input-vat rows', () => {
    const cells = createEmptyCells();
    cells[5] = '부가세';
    cells[6] = '매입부가세';
    cells[8] = '매입부가세';
    cells[10] = '33,000';
    cells[14] = '3,000';
    const result = aggregateBudgetActualsFromSettlementRows([createRow(cells)]);

    expect(result.get('부가세|매입부가세')).toBe(3000);
  });

  it('excludes inflow rows from budget spending', () => {
    const cells = createEmptyCells();
    cells[5] = '사업수익';
    cells[6] = '매출';
    cells[8] = '매출액(입금)';
    cells[10] = '250,000';
    const result = aggregateBudgetActualsFromSettlementRows([createRow(cells)]);

    expect(result.size).toBe(0);
    expect(getTotalBudgetActualFromSettlementRows([createRow(cells)])).toBe(0);
  });

  it('excludes refund-driven inflow rows from budget spending', () => {
    const cells = createEmptyCells();
    cells[5] = '부가세';
    cells[6] = '환급';
    cells[8] = '매출부가세(입금)';
    cells[12] = '20,000';
    const result = aggregateBudgetActualsFromSettlementRows([createRow(cells)]);

    expect(result.size).toBe(0);
    expect(getTotalBudgetActualFromSettlementRows([createRow(cells)])).toBe(0);
  });

  it('falls back to bank amount when an outflow line exists but no derived expense exists', () => {
    const cells = createEmptyCells();
    cells[5] = '여비';
    cells[6] = '교통비';
    cells[8] = '직접사업비';
    cells[10] = '15,000';
    const result = aggregateBudgetActualsFromSettlementRows([createRow(cells)]);

    expect(result.get('여비|교통비')).toBe(15000);
    expect(getTotalBudgetActualFromSettlementRows([createRow(cells)])).toBe(15000);
  });

  it('excludes bank-imported outflow rows until a human confirms the split', () => {
    const cells = createEmptyCells();
    cells[5] = '여비';
    cells[6] = '교통비';
    cells[8] = '직접사업비';
    cells[10] = '15,000';
    const row = createRow(cells);
    row.sourceTxId = 'bank:expense-1';
    row.entryKind = 'EXPENSE';

    const result = aggregateBudgetActualsFromSettlementRows([row]);

    expect(result.size).toBe(0);
    expect(getTotalBudgetActualFromSettlementRows([row])).toBe(0);
  });

  it('excludes rows without a cashflow line until a human classifies them', () => {
    const cells = createEmptyCells();
    cells[5] = '여비';
    cells[6] = '교통비';
    cells[10] = '15,000';

    const result = aggregateBudgetActualsFromSettlementRows([createRow(cells)]);

    expect(result.size).toBe(0);
    expect(getTotalBudgetActualFromSettlementRows([createRow(cells)])).toBe(0);
  });
});
