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
});
