import { describe, expect, it } from 'vitest';
import {
  getCashflowCategoryLabel,
  getCashflowLineLabel,
  getCashflowSheetLineIdFromCategory,
  getCashflowCategoryFromSheetLineId,
  getCashflowExportLabel,
  parseCashflowCategoryLabel,
  parseCashflowLineLabelAlias,
  listCashflowCategoryOptionsForDirection,
  listCashflowLineOptions,
} from './cashflow-policy';

describe('cashflow-policy', () => {
  it('returns canonical labels for categories', () => {
    expect(getCashflowCategoryLabel('OUTSOURCING')).toBe('외주비');
    expect(getCashflowCategoryLabel('TRAVEL')).toBe('출장비');
    expect(getCashflowCategoryLabel('VAT_REFUND')).toBe('부가세환급');
  });

  it('parses canonical category labels', () => {
    expect(parseCashflowCategoryLabel('외주비')).toBe('OUTSOURCING');
    expect(parseCashflowCategoryLabel('출장비')).toBe('TRAVEL');
    expect(parseCashflowCategoryLabel('알 수 없음')).toBeUndefined();
  });

  it('returns canonical line labels and aliases', () => {
    expect(getCashflowLineLabel('DIRECT_COST_OUT')).toBe('직접사업비');
    expect(getCashflowExportLabel('MYSC_PREPAY_IN')).toBe('MYSC 선입금(잔금 등 입금 필요 시)');
    expect(parseCashflowLineLabelAlias('직접사업비(공급가액)+매입부가세')).toBe('DIRECT_COST_OUT');
    expect(parseCashflowLineLabelAlias('MYSC선입금')).toBe('MYSC_PREPAY_IN');
  });

  it('maps categories to stable line ids by direction', () => {
    expect(getCashflowSheetLineIdFromCategory('OUTSOURCING', 'OUT')).toBe('DIRECT_COST_OUT');
    expect(getCashflowSheetLineIdFromCategory('TRAVEL', 'OUT')).toBe('DIRECT_COST_OUT');
    expect(getCashflowSheetLineIdFromCategory('VAT_REFUND', 'IN')).toBe('SALES_VAT_IN');
    expect(getCashflowSheetLineIdFromCategory('TAX_PAYMENT', 'OUT')).toBe('SALES_VAT_OUT');
  });

  it('maps line ids back to compatibility categories', () => {
    expect(getCashflowCategoryFromSheetLineId('DIRECT_COST_OUT', 'OUT')).toBe('OUTSOURCING');
    expect(getCashflowCategoryFromSheetLineId('INPUT_VAT_OUT', 'OUT')).toBe('TAX_PAYMENT');
    expect(getCashflowCategoryFromSheetLineId('MYSC_LABOR_OUT', 'OUT')).toBe('LABOR_COST');
    expect(getCashflowCategoryFromSheetLineId('SALES_IN', 'IN')).toBe('CONTRACT_PAYMENT');
  });

  it('lists direction-aware category and line options', () => {
    expect(listCashflowCategoryOptionsForDirection('IN').map((option) => option.value)).toEqual([
      'CONTRACT_PAYMENT',
      'INTERIM_PAYMENT',
      'FINAL_PAYMENT',
      'VAT_REFUND',
      'MISC_INCOME',
    ]);

    expect(listCashflowLineOptions('OUT').map((option) => option.value)).toEqual([
      'DIRECT_COST_OUT',
      'INPUT_VAT_OUT',
      'MYSC_LABOR_OUT',
      'MYSC_PROFIT_OUT',
      'SALES_VAT_OUT',
      'TEAM_SUPPORT_OUT',
      'BANK_INTEREST_OUT',
    ]);
  });
});
