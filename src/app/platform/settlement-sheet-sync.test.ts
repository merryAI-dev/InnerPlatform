import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import { buildSettlementActualSyncPayload } from './settlement-sheet-sync';

function createRow(cells: string[]): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2)}`,
    cells,
  };
}

function createEmptyCells(): string[] {
  return Array.from({ length: 26 }, () => '');
}

function withCell(cells: string[], index: number, value: string): string[] {
  const next = [...cells];
  next[index] = value;
  return next;
}

describe('buildSettlementActualSyncPayload', () => {
  it('builds weekly actual payloads from current rows', () => {
    const base = createEmptyCells();
    const rows = [
      createRow(
        withCell(
          withCell(
            withCell(base, 2, '2026-03-03'),
            3,
            '26-03-01',
          ),
          8,
          '직접사업비',
        ).map((cell, index) => (index === 10 ? '110,000' : cell)),
      ),
      createRow(
        withCell(
          withCell(
            withCell(base, 2, '2026-03-04'),
            3,
            '26-03-01',
          ),
          8,
          '매출액(입금)',
        ).map((cell, index) => (index === 10 ? '250,000' : cell)),
      ),
    ];

    const payload = buildSettlementActualSyncPayload(rows, [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    expect(payload).toHaveLength(1);
    const marchWeek = payload.find((item) => item.yearMonth === '2026-03' && item.weekNo === 1);
    expect(marchWeek?.amounts.DIRECT_COST_OUT).toBe(110000);
    expect(marchWeek?.amounts.SALES_IN).toBe(250000);
  });

  it('includes cleared weeks from persisted rows so removed rows zero out previous actuals', () => {
    const base = createEmptyCells();
    const currentRows = [
      createRow(withCell(withCell(withCell(base, 2, '2026-03-03'), 3, '26-03-01'), 8, '직접사업비').map((cell, index) => (index === 10 ? '10,000' : cell))),
    ];
    const persistedRows = [
      createRow(withCell(withCell(withCell(base, 2, '2026-03-12'), 3, '26-03-02'), 8, '직접사업비').map((cell, index) => (index === 10 ? '20,000' : cell))),
    ];

    const payload = buildSettlementActualSyncPayload(currentRows, [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
      { yearMonth: '2026-03', weekNo: 2, weekStart: '2026-03-09', weekEnd: '2026-03-15', label: '26-03-02' },
    ], persistedRows);

    const currentWeek = payload.find((item) => item.yearMonth === '2026-03' && item.weekNo === 1);
    const clearedWeek = payload.find((item) => item.yearMonth === '2026-03' && item.weekNo === 2);
    expect(currentWeek?.amounts.DIRECT_COST_OUT).toBe(10000);
    expect(clearedWeek?.amounts.DIRECT_COST_OUT).toBe(0);
  });

  it('ignores input vat out rows when building actual payloads', () => {
    const base = createEmptyCells();
    const rows = [
      createRow(withCell(withCell(withCell(base, 2, '2026-03-03'), 3, '26-03-01'), 8, '매입부가세').map((cell, index) => (index === 10 ? '33,000' : cell))),
    ];

    const payload = buildSettlementActualSyncPayload(rows, [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    const marchWeek = payload.find((item) => item.yearMonth === '2026-03' && item.weekNo === 1);
    expect(marchWeek?.amounts.INPUT_VAT_OUT).toBe(0);
  });
});
