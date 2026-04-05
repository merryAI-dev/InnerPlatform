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
        ).map((cell, index) => (index === 11 ? '250,000' : cell)),
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

  it('splits outflow rows into primary out line and input vat out', () => {
    const base = createEmptyCells();
    const row = createRow(
      withCell(
        withCell(
          withCell(base, 2, '2026-03-05'),
          3,
          '26-03-01',
        ),
        8,
        '직접사업비(공급가액)+매입부가세',
      ),
    );
    row.cells[13] = '100,000';
    row.cells[14] = '10,000';

    const payload = buildSettlementActualSyncPayload([row], [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(100000);
    expect(payload[0]?.amounts.INPUT_VAT_OUT).toBe(10000);
  });

  it('keeps inflow vat lines on the inflow side', () => {
    const base = createEmptyCells();
    const row = createRow(
      withCell(
        withCell(
          withCell(base, 2, '2026-03-05'),
          3,
          '26-03-01',
        ),
        8,
        '매출부가세(입금)',
      ),
    );
    row.cells[11] = '20,000';

    const payload = buildSettlementActualSyncPayload([row], [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    expect(payload[0]?.amounts.SALES_VAT_IN).toBe(20000);
    expect(payload[0]?.amounts.INPUT_VAT_OUT).toBe(0);
  });

  it('prefers expense amount for outflow actuals and falls back to bank amount when missing', () => {
    const base = createEmptyCells();
    const expensePriorityRow = createRow(
      withCell(
        withCell(
          withCell(
            withCell(base, 2, '2026-03-05'),
            3,
            '26-03-01',
          ),
          8,
          '직접사업비',
        ),
        10,
        '33,000',
      ).map((cell, index) => (index === 13 ? '30,000' : cell)),
    );
    const fallbackRow = createRow(
      withCell(
        withCell(
          withCell(base, 2, '2026-03-06'),
          3,
          '26-03-01',
        ),
        8,
        '직접사업비',
      ).map((cell, index) => (index === 10 ? '15,000' : cell)),
    );

    const payload = buildSettlementActualSyncPayload([expensePriorityRow, fallbackRow], [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(45000);
  });

  it('derives week labels from transaction date when the imported week column is blank', () => {
    const base = createEmptyCells();
    const row = createRow(
      withCell(
        withCell(base, 2, '2026-03-05'),
        8,
        '직접사업비',
      ).map((cell, index) => (index === 13 ? '30,000' : cell)),
    );

    const payload = buildSettlementActualSyncPayload([row], [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    expect(payload).toHaveLength(1);
    expect(payload[0]?.yearMonth).toBe('2026-03');
    expect(payload[0]?.weekNo).toBe(1);
    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(30000);
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

  it('includes input vat out rows when building actual payloads', () => {
    const base = createEmptyCells();
    const rows = [
      createRow(withCell(withCell(withCell(base, 2, '2026-03-03'), 3, '26-03-01'), 8, '매입부가세').map((cell, index) => (index === 10 ? '33,000' : cell))),
    ];
    rows[0].cells[14] = '3,000';

    const payload = buildSettlementActualSyncPayload(rows, [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    const marchWeek = payload.find((item) => item.yearMonth === '2026-03' && item.weekNo === 1);
    expect(marchWeek?.amounts.INPUT_VAT_OUT).toBe(3000);
  });

  it('excludes bank-imported outflow rows until a human enters the split amounts', () => {
    const base = createEmptyCells();
    const row = createRow(
      withCell(
        withCell(
          withCell(base, 2, '2026-03-03'),
          3,
          '26-03-01',
        ),
        8,
        '직접사업비',
      ).map((cell, index) => (index === 10 ? '110,000' : cell)),
    );
    row.sourceTxId = 'bank:expense-1';
    row.entryKind = 'EXPENSE';

    const payload = buildSettlementActualSyncPayload([row], [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
    ]);

    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(0);
    expect(payload[0]?.amounts.INPUT_VAT_OUT).toBe(0);
  });
});
