import type { BankImportManualFields, CashflowCategory, CashflowSheetLineId, Direction } from '../data/types';
import { CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES, mapCategoryToSheetLine } from './cashflow-sheet';
import { CASHFLOW_LINE_OPTIONS } from './settlement-csv';

function resolveDirectionForAmount(signedAmount: number): Direction {
  return signedAmount >= 0 ? 'IN' : 'OUT';
}

export function mapCashflowLineToCategory(
  lineId: CashflowSheetLineId | undefined,
  direction: Direction,
): CashflowCategory {
  if (!lineId) return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
  switch (lineId) {
    case 'MYSC_PREPAY_IN':
    case 'SALES_IN':
      return 'CONTRACT_PAYMENT';
    case 'SALES_VAT_IN':
      return 'VAT_REFUND';
    case 'TEAM_SUPPORT_IN':
    case 'BANK_INTEREST_IN':
      return 'MISC_INCOME';
    case 'DIRECT_COST_OUT':
      return 'OUTSOURCING';
    case 'INPUT_VAT_OUT':
    case 'SALES_VAT_OUT':
      return 'TAX_PAYMENT';
    case 'MYSC_LABOR_OUT':
      return 'LABOR_COST';
    case 'MYSC_PROFIT_OUT':
    case 'TEAM_SUPPORT_OUT':
    case 'BANK_INTEREST_OUT':
      return 'MISC_EXPENSE';
    default:
      return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
  }
}

export function resolveBankImportCashflowOptionsForAmount(signedAmount: number) {
  const allowed = new Set(signedAmount >= 0 ? CASHFLOW_IN_LINES : CASHFLOW_OUT_LINES);
  return CASHFLOW_LINE_OPTIONS.filter((option) => allowed.has(option.value));
}

export function resolveBankImportCashflowSelection(
  lineId: CashflowSheetLineId,
  signedAmount: number,
): Pick<BankImportManualFields, 'cashflowLineId' | 'cashflowCategory'> {
  const direction = resolveDirectionForAmount(signedAmount);
  return {
    cashflowLineId: lineId,
    cashflowCategory: mapCashflowLineToCategory(lineId, direction),
  };
}

export function resolveBankImportCashflowLineId(
  fields: Pick<BankImportManualFields, 'cashflowLineId' | 'cashflowCategory'> | null | undefined,
  signedAmount: number,
): CashflowSheetLineId | undefined {
  if (fields?.cashflowLineId) return fields.cashflowLineId;
  if (!fields?.cashflowCategory) return undefined;
  return mapCategoryToSheetLine(resolveDirectionForAmount(signedAmount), fields.cashflowCategory);
}
