import { describe, expect, it } from 'vitest';
import { normalizeProjectFinancialInputFlagsForAmounts } from './project-contract-amount';
import { normalizeProjectRevenueFields, resolveProjectRevenueFinancials } from './project-financials';

describe('resolveProjectRevenueFinancials', () => {
  it('uses total revenue as the shared profit amount and derives the profit rate', () => {
    expect(resolveProjectRevenueFinancials({
      contractAmount: 100_000,
      totalRevenueAmount: 91_000,
      profitAmount: 0,
      profitRate: 0,
      preferredSource: 'totalRevenueAmount',
    })).toEqual({
      totalRevenueAmount: 91_000,
      profitAmount: 91_000,
      profitRate: 0.91,
    });
  });

  it('uses profit rate to derive the shared revenue amount when admin edits only the rate', () => {
    expect(resolveProjectRevenueFinancials({
      contractAmount: 100_000,
      totalRevenueAmount: 0,
      profitAmount: 0,
      profitRate: 0.91,
      preferredSource: 'profitRate',
    })).toEqual({
      totalRevenueAmount: 91_000,
      profitAmount: 91_000,
      profitRate: 0.91,
    });
  });

  it('normalizes stale project compatibility fields from canonical total revenue', () => {
    expect(normalizeProjectRevenueFields({
      id: 'p-1',
      contractAmount: 100_000,
      totalRevenueAmount: 91_000,
      profitAmount: 1,
      profitRate: 0.01,
    }, 'totalRevenueAmount')).toMatchObject({
      id: 'p-1',
      totalRevenueAmount: 91_000,
      profitAmount: 91_000,
      profitRate: 0.91,
    });
  });

  it('normalizes legacy rate-only projects into canonical total revenue', () => {
    expect(normalizeProjectRevenueFields({
      id: 'p-legacy',
      contractAmount: 100_000,
      profitRate: 0.3,
    })).toMatchObject({
      id: 'p-legacy',
      totalRevenueAmount: 30_000,
      profitAmount: 30_000,
      profitRate: 0.3,
    });
  });
});

describe('normalizeProjectFinancialInputFlagsForAmounts', () => {
  it('treats existing positive amounts as explicit values for edit forms', () => {
    expect(normalizeProjectFinancialInputFlagsForAmounts(undefined, {
      contractAmount: 100_000,
      salesVatAmount: 10_000,
      totalRevenueAmount: 91_000,
      supportAmount: 0,
    })).toEqual({
      contractAmount: true,
      salesVatAmount: true,
      totalRevenueAmount: true,
      supportAmount: false,
    });
  });
});
