import { describe, expect, it } from 'vitest';
import {
  buildCashflowActualSyncPlan,
  getMonthCashflowWeeks,
  parseCashflowLineLabel,
} from './cashflow-canonical-store.mjs';

function row(cells, extra = {}) {
  return {
    tempId: extra.tempId || `row-${Math.random()}`,
    cells: [
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      ...[],
    ].map((value, index) => cells[index] ?? value),
    ...extra,
  };
}

describe('cashflow canonical BFF helpers', () => {
  it('uses the same Wednesday-based week buckets as the app cashflow sheet', () => {
    expect(getMonthCashflowWeeks('2027-01').map((week) => week.label)).toEqual([
      '27-1-1',
      '27-1-2',
      '27-1-3',
      '27-1-4',
      '27-1-5',
    ]);
    expect(getMonthCashflowWeeks('2027-01')[0]).toMatchObject({
      yearMonth: '2027-01',
      weekNo: 1,
      weekStart: '2026-12-30',
      weekEnd: '2027-01-05',
    });
  });

  it('parses cashflow labels and aliases without relying on frontend code', () => {
    expect(parseCashflowLineLabel('직접사업비(공급가액)')).toBe('DIRECT_COST_OUT');
    expect(parseCashflowLineLabel('MYSC인건비')).toBe('MYSC_LABOR_OUT');
  });

  it('aggregates actuals from persisted expense rows and clears stale managed weeks', () => {
    const plan = buildCashflowActualSyncPlan({
      anchorYear: 2026,
      previousWeekKeys: ['2026-05:w1', '2026-05:w2'],
      rows: [
        row({
          2: '2026-05-01',
          8: 'MYSC 인건비',
          10: '48,064,130',
          13: '48,064,130',
        }, { tempId: 'labor' }),
        row({
          3: '26-5-1',
          8: '직접사업비',
          10: '3,637,422',
          13: '3,620,183',
          14: '17,239',
        }, { tempId: 'direct' }),
      ],
    });

    expect(plan.weeks).toHaveLength(1);
    expect(plan.weeks[0].yearMonth).toBe('2026-05');
    expect(plan.weeks[0].amounts.MYSC_LABOR_OUT).toBe(48064130);
    expect(plan.weeks[0].amounts.DIRECT_COST_OUT).toBe(3620183);
    expect(plan.weeks[0].amounts.INPUT_VAT_OUT).toBe(17239);
    expect(plan.clearedWeeks).toHaveLength(1);
    expect(plan.clearedWeeks[0]).toMatchObject({ yearMonth: '2026-05', weekNo: 2 });
    expect(plan.clearedWeeks[0].amounts.MYSC_LABOR_OUT).toBe(0);
  });

  it('treats bank-imported expense rows on inflow lines as negative adjustments', () => {
    const plan = buildCashflowActualSyncPlan({
      anchorYear: 2026,
      rows: [
        row({
          3: '26-5-1',
          8: 'MYSC 선입금(잔금 등 입금 필요 시)',
          10: '8,615,904',
        }, { tempId: 'prepay-out', sourceTxId: 'bank:abc', entryKind: 'EXPENSE' }),
      ],
    });

    expect(plan.weeks[0].amounts.MYSC_PREPAY_IN).toBe(-8615904);
  });
});
