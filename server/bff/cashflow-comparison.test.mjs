import { describe, expect, it } from 'vitest';
import { CASHFLOW_ALL_LINES } from './cashflow-policy.mjs';
import { buildCashflowProjectionActualComparison } from './cashflow-comparison.mjs';

describe('cashflow Projection - Actual comparison', () => {
  it('keeps the fixed 16-line order and computes Projection minus Actual', () => {
    const result = buildCashflowProjectionActualComparison({
      projectId: 'project-a',
      readModel: {
        months: [{
          yearMonth: '2026-01',
          projection: {
            weeks: [{
              weekNo: 1,
              amounts: { SALES_IN: 1000, DIRECT_COST_OUT: 400 },
            }],
          },
          actual: {
            weeks: [{
              weekNo: 1,
              amounts: { SALES_IN: 700, DIRECT_COST_OUT: 500, BANK_INTEREST_IN: 10 },
            }],
          },
        }],
      },
    }, { asOfDate: '2026-01-31' });

    expect(result.direction).toBe('projection_minus_actual');
    expect(result).toMatchObject({
      asOfDate: '2026-01-31',
      asOfWeek: { yearMonth: '2026-01', weekNo: 5 },
      timeZone: 'Asia/Seoul',
    });
    expect(result.lineOrder).toEqual(CASHFLOW_ALL_LINES);
    const week = result.months[0].weeks[0];
    expect(week.lines.map((line) => line.lineId)).toEqual(CASHFLOW_ALL_LINES);
    expect(week.lines.find((line) => line.lineId === 'SALES_IN')).toMatchObject({
      projection: 1000,
      projectionHadValue: true,
      actual: 700,
      actualHadValue: true,
      difference: 300,
    });
    expect(week.lines.find((line) => line.lineId === 'BANK_INTEREST_IN')).toMatchObject({
      projection: 0,
      projectionHadValue: false,
      actual: 10,
      actualHadValue: true,
      difference: -10,
    });
    expect(week.totals).toEqual({
      projection: { totalIn: 1000, totalOut: 400, balance: 600 },
      actual: { totalIn: 710, totalOut: 500, balance: 210 },
      difference: { totalIn: 290, totalOut: -100, balance: 390 },
    });
    expect(week).toMatchObject({
      amounts: { SALES_IN: 300, BANK_INTEREST_IN: -10, DIRECT_COST_OUT: -100 },
      totalIn: 290,
      totalOut: -100,
      net: 390,
    });
    expect(result.months[0]).toMatchObject({
      rowTotals: { SALES_IN: 300, BANK_INTEREST_IN: -10, DIRECT_COST_OUT: -100 },
      totalIn: 290,
      totalOut: -100,
      net: 390,
    });
  });

  it('uses the union of Projection and Actual weeks and sorts them', () => {
    const result = buildCashflowProjectionActualComparison({
      projectId: 'project-a',
      readModel: {
        months: [{
          yearMonth: '2026-02',
          projection: { weeks: [{ weekNo: 2, amounts: { SALES_IN: 20 } }] },
          actual: { weeks: [{ weekNo: 1, amounts: { SALES_IN: 10 } }] },
        }],
      },
    }, { asOfDate: '2026-02-28' });
    expect(result.months[0].weeks.map((week) => week.weekNo)).toEqual([1, 2]);
    expect(result.months[0].totals).toEqual({
      projection: { totalIn: 20, totalOut: 0, balance: 20 },
      actual: { totalIn: 10, totalOut: 0, balance: 10 },
      difference: { totalIn: 10, totalOut: 0, balance: 10 },
    });
  });

  it('ignores unknown line IDs instead of letting them change finance totals', () => {
    const result = buildCashflowProjectionActualComparison({
      readModel: {
        months: [{
          yearMonth: '2026-03',
          projection: { weeks: [{ weekNo: 1, amounts: { UNKNOWN: 999, SALES_IN: 1 } }] },
          actual: { weeks: [] },
        }],
      },
    }, { asOfDate: '2026-03-31' });
    expect(result.months[0].totals.projection).toEqual({ totalIn: 1, totalOut: 0, balance: 1 });
    expect(result.ignoredLineIds).toEqual(['UNKNOWN']);
  });

  it('excludes weeks after the explicit as-of finance week', () => {
    const result = buildCashflowProjectionActualComparison({
      projectId: 'project-a',
      readModel: {
        months: [
          {
            yearMonth: '2026-06',
            projection: {
              weeks: [
                { weekNo: 2, amounts: { SALES_IN: 20 } },
                { weekNo: 3, amounts: { SALES_IN: 30 } },
                { weekNo: 4, amounts: { SALES_IN: 40 } },
              ],
            },
            actual: { weeks: [] },
          },
          {
            yearMonth: '2026-07',
            projection: { weeks: [{ weekNo: 1, amounts: { SALES_IN: 100 } }] },
            actual: { weeks: [] },
          },
        ],
      },
    }, { asOfDate: '2026-06-17' });

    expect(result.asOfWeek).toEqual({ yearMonth: '2026-06', weekNo: 3 });
    expect(result.months[0].weeks.map((week) => week.weekNo)).toEqual([2, 3]);
    expect(result.months[0]).toMatchObject({ totalIn: 50, totalOut: 0, net: 50 });
    expect(result.months[1]).toMatchObject({ weeks: [], totalIn: 0, totalOut: 0, net: 0 });
  });

  it('rejects an invalid as-of date instead of guessing the comparison boundary', () => {
    expect(() => buildCashflowProjectionActualComparison({ readModel: { months: [] } }, {
      asOfDate: '2026-02-30',
    })).toThrow('Invalid cashflow comparison as-of date');
  });
});
