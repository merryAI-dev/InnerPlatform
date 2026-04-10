import { describe, expect, it } from 'vitest';
import {
  resolveBankImportCashflowLineId,
  resolveBankImportCashflowOptionsForAmount,
  resolveBankImportCashflowSelection,
} from './bank-import-cashflow';

describe('bank-import-cashflow helpers', () => {
  it('shows only outflow sheet lines for expense rows', () => {
    const options = resolveBankImportCashflowOptionsForAmount(-15000);

    expect(options.map((option) => option.value)).toEqual([
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
    expect(resolveBankImportCashflowSelection('MYSC_LABOR_OUT', -120000)).toEqual({
      cashflowLineId: 'MYSC_LABOR_OUT',
      cashflowCategory: 'LABOR_COST',
    });
  });

  it('falls back from legacy category to a stable sheet line id', () => {
    expect(resolveBankImportCashflowLineId({
      cashflowCategory: 'TRAVEL',
    }, -15000)).toBe('DIRECT_COST_OUT');

    expect(resolveBankImportCashflowLineId({
      cashflowCategory: 'VAT_REFUND',
    }, 50000)).toBe('SALES_VAT_IN');
  });
});
