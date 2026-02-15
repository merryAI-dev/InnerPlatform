import { describe, expect, it } from 'vitest';
import { chooseCashflowSheetForNet, computeCashflowTotals } from './cashflow-sheet';

describe('cashflow sheet', () => {
  it('computes totals for empty sheets', () => {
    expect(computeCashflowTotals(undefined)).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
    expect(computeCashflowTotals({})).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
  });

  it('computes totals for partial sheets', () => {
    const { totalIn, totalOut, net } = computeCashflowTotals({
      MYSC_PREPAY_IN: 5_000_000,
      TEAM_SUPPORT_IN: 1_000_000,
      DIRECT_COST_OUT: 1_000_000,
      MYSC_LABOR_OUT: 500_000,
    });
    expect(totalIn).toBe(6_000_000);
    expect(totalOut).toBe(1_500_000);
    expect(net).toBe(4_500_000);
  });

  it('chooses actual when any keys exist, otherwise projection', () => {
    expect(chooseCashflowSheetForNet({ actual: undefined, projection: { SALES_IN: 100 } })).toEqual({
      source: 'projection',
      sheet: { SALES_IN: 100 },
    });

    expect(chooseCashflowSheetForNet({ actual: {}, projection: { SALES_IN: 100 } })).toEqual({
      source: 'projection',
      sheet: { SALES_IN: 100 },
    });

    expect(chooseCashflowSheetForNet({ actual: { SALES_IN: 0 }, projection: { SALES_IN: 100 } })).toEqual({
      source: 'actual',
      sheet: { SALES_IN: 0 },
    });
  });
});

