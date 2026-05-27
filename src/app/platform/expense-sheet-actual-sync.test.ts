import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import { buildProjectExpenseRowsForActualSync } from './expense-sheet-actual-sync';
import { buildSettlementActualSyncPayload } from './settlement-sheet-sync';

function row(tempId: string): ImportRow {
  return {
    tempId,
    cells: [],
  };
}

function settlementRow(input: {
  tempId: string;
  date: string;
  week: string;
  cashflowLine: string;
  amount: string;
}): ImportRow {
  const cells = Array.from({ length: 26 }, () => '');
  cells[2] = input.date;
  cells[3] = input.week;
  cells[8] = input.cashflowLine;
  cells[10] = input.amount;
  return {
    tempId: input.tempId,
    cells,
  };
}

describe('buildProjectExpenseRowsForActualSync', () => {
  it('aggregates every expense sheet and replaces only the active sheet rows', () => {
    const result = buildProjectExpenseRowsForActualSync({
      activeSheetId: 'sheet-2',
      activeRows: [row('sheet-2-edited')],
      sheets: [
        { id: 'default', rows: [row('default-1')] },
        { id: 'sheet-2', rows: [row('sheet-2-old')] },
        { id: 'sheet-3', rows: [row('sheet-3-1')] },
      ],
    });

    expect(result.map((item) => item.tempId)).toEqual([
      'default-1',
      'sheet-2-edited',
      'sheet-3-1',
    ]);
  });

  it('keeps edited active rows even before the active sheet exists in the snapshot', () => {
    const result = buildProjectExpenseRowsForActualSync({
      activeSheetId: 'new-sheet',
      activeRows: [row('new-sheet-edited')],
      sheets: [
        { id: 'default', rows: [row('default-1')] },
      ],
    });

    expect(result.map((item) => item.tempId)).toEqual([
      'default-1',
      'new-sheet-edited',
    ]);
  });

  it('builds actual payload from all sheets so saving one tab does not clear another tab actual', () => {
    const activeRows = [
      settlementRow({
        tempId: 'active-edited',
        date: '2026-05-05',
        week: '26-05-01',
        cashflowLine: '직접사업비',
        amount: '10,000',
      }),
    ];
    const projectRows = buildProjectExpenseRowsForActualSync({
      activeSheetId: 'sheet-2',
      activeRows,
      sheets: [
        {
          id: 'default',
          rows: [
            settlementRow({
              tempId: 'default-existing',
              date: '2026-05-06',
              week: '26-05-01',
              cashflowLine: 'MYSC 인건비',
              amount: '40,000',
            }),
          ],
        },
        {
          id: 'sheet-2',
          rows: [
            settlementRow({
              tempId: 'active-old',
              date: '2026-05-05',
              week: '26-05-01',
              cashflowLine: '직접사업비',
              amount: '5,000',
            }),
          ],
        },
      ],
    });

    const payload = buildSettlementActualSyncPayload(projectRows, [
      { yearMonth: '2026-05', weekNo: 1, weekStart: '2026-05-04', weekEnd: '2026-05-10', label: '26-05-01' },
    ]);

    expect(payload).toHaveLength(1);
    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(10000);
    expect(payload[0]?.amounts.MYSC_LABOR_OUT).toBe(40000);
  });
});
