import { describe, expect, it } from 'vitest';
import { summarizeCashflowAnnualMode } from './cashflow-annual-total.mjs';

describe('cashflow annual total row states', () => {
  it('keeps an explicit ZERO amount distinct from EMPTY', () => {
    const summary = summarizeCashflowAnnualMode({
      projection: { SALES_IN: 0 },
      projectionStates: { SALES_IN: 'ZERO', TEAM_SUPPORT_IN: 'EMPTY' },
    }, 'projection');

    expect(summary.lineAmounts).toHaveProperty('SALES_IN', 0);
    expect(summary.lineAmounts).not.toHaveProperty('TEAM_SUPPORT_IN');
    expect(summary.lineStates).toMatchObject({ SALES_IN: 'ZERO', TEAM_SUPPORT_IN: 'EMPTY' });
    expect(summary.net).toBe(0);
  });

  it('reports a decimal amount as invalid instead of dropping it silently', () => {
    const summary = summarizeCashflowAnnualMode({
      projection: { SALES_IN: 1000.5 },
      projectionStates: { SALES_IN: 'VALUE' },
    }, 'projection');

    expect(summary.invalidCellCount).toBe(1);
    expect(summary.valueCellCount).toBe(0);
    expect(summary.lineAmounts).not.toHaveProperty('SALES_IN');
    expect(summary.lineStates).toMatchObject({ SALES_IN: 'VALUE' });
  });

  it('reports an amount beyond the safe whole-won range as invalid', () => {
    const summary = summarizeCashflowAnnualMode({
      actual: { DIRECT_COST_OUT: 9007199254740993 },
      actualStates: { DIRECT_COST_OUT: 'VALUE' },
    }, 'actual');

    expect(summary.invalidCellCount).toBe(1);
    expect(summary.totalOut).toBe(0);
  });

  it('keeps valid amounts when another line on the same mode is invalid', () => {
    const summary = summarizeCashflowAnnualMode({
      projection: { SALES_IN: 3000000, TEAM_SUPPORT_IN: 0.7 },
      projectionStates: { SALES_IN: 'VALUE', TEAM_SUPPORT_IN: 'VALUE' },
    }, 'projection');

    expect(summary.totalIn).toBe(3000000);
    expect(summary.valueCellCount).toBe(1);
    expect(summary.invalidCellCount).toBe(1);
  });
});
