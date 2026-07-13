import { describe, expect, it } from 'vitest';
import {
  resolveBankImportCashflowLineId,
  resolveBankImportCashflowOptionsForAmount,
  resolveBankImportCashflowSelection,
} from './bank-import-cashflow';

describe('bank-import-cashflow helpers', () => {
  it('shows only outflow sheet lines for expense rows', () => {
    const options = resolveBankImportCashflowOptionsForAmount(15000, 'EXPENSE');

    expect(options.map((option) => option.value)).toEqual([
      'MYSC_PREPAY_DIRECT_OUT',
      'MYSC_PREPAY_LABOR_OUT',
      'DIRECT_COST_OUT',
      'INPUT_VAT_OUT',
      'MYSC_LABOR_OUT',
      'MYSC_PROFIT_OUT',
      'SALES_VAT_OUT',
      'TEAM_SUPPORT_OUT',
      'BANK_INTEREST_OUT',
    ]);
  });

  it('stores sheet line id alongside compatibility category', () => {
    expect(resolveBankImportCashflowSelection('MYSC_LABOR_OUT', 120000, 'EXPENSE')).toEqual({
      cashflowLineId: 'MYSC_LABOR_OUT',
      cashflowCategory: 'LABOR_COST',
    });
  });

  it.each([
    ['MYSC_PREPAY_LABOR_IN', 120000, 'DEPOSIT', 'CONTRACT_PAYMENT'],
    ['MYSC_PREPAY_INPUT_VAT_IN', 120000, 'DEPOSIT', 'VAT_REFUND'],
    ['MYSC_PREPAY_DIRECT_OUT', 120000, 'EXPENSE', 'OUTSOURCING'],
    ['MYSC_PREPAY_LABOR_OUT', 120000, 'EXPENSE', 'LABOR_COST'],
  ] as const)('does not collapse explicit line %s to its category default', (
    cashflowLineId,
    signedAmount,
    entryKind,
    cashflowCategory,
  ) => {
    expect(resolveBankImportCashflowSelection(cashflowLineId, signedAmount, entryKind)).toEqual({
      cashflowLineId,
      cashflowCategory,
    });
  });

  it('falls back from legacy category to a stable sheet line id', () => {
    expect(resolveBankImportCashflowLineId({
      cashflowCategory: 'TRAVEL',
    }, 15000, 'EXPENSE')).toBe('DIRECT_COST_OUT');

    expect(resolveBankImportCashflowLineId({
      cashflowCategory: 'VAT_REFUND',
    }, 50000, 'DEPOSIT')).toBe('SALES_VAT_IN');
  });
});
