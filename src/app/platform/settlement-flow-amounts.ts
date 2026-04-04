import { parseNumber } from './csv-utils';
import { parseCashflowLineLabel, type ImportRow } from './settlement-csv';

const CASHFLOW_IN_LINE_IDS = new Set<string>([
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
]);

export interface SettlementFlowAmountIndexes {
  cashflowIdx: number;
  bankAmountIdx: number;
  expenseAmountIdx: number;
  vatInIdx: number;
  depositIdx: number;
  refundIdx: number;
}

export interface SettlementRowFlowAmounts {
  lineId?: string;
  bankAmount: number;
  expenseAmount: number;
  vatIn: number;
  depositAmount: number;
  refundAmount: number;
}

function parseAmount(cells: string[], index: number): number {
  if (index < 0) return 0;
  return parseNumber(cells[index] || '') ?? 0;
}

export function resolveSettlementRowFlowAmounts(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): SettlementRowFlowAmounts {
  const cashflowLabel = indexes.cashflowIdx >= 0 ? String(row.cells[indexes.cashflowIdx] || '').trim() : '';
  return {
    lineId: parseCashflowLineLabel(cashflowLabel),
    bankAmount: parseAmount(row.cells, indexes.bankAmountIdx),
    expenseAmount: parseAmount(row.cells, indexes.expenseAmountIdx),
    vatIn: parseAmount(row.cells, indexes.vatInIdx),
    depositAmount: parseAmount(row.cells, indexes.depositIdx),
    refundAmount: parseAmount(row.cells, indexes.refundIdx),
  };
}

export function resolveSettlementActualSyncAmount(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): number {
  const amounts = resolveSettlementCashflowActualLineAmounts(row, indexes);
  const lineId = resolveSettlementRowFlowAmounts(row, indexes).lineId;
  if (!lineId) return 0;
  return amounts[lineId] || 0;
}

export function resolveSettlementCashflowActualLineAmounts(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): Partial<Record<string, number>> {
  const amounts = resolveSettlementRowFlowAmounts(row, indexes);
  if (!amounts.lineId) return {};

  if (CASHFLOW_IN_LINE_IDS.has(amounts.lineId)) {
    const inflowAmount = amounts.depositAmount > 0
      ? amounts.depositAmount
      : amounts.refundAmount > 0
        ? amounts.refundAmount
        : amounts.bankAmount;
    return inflowAmount > 0 ? { [amounts.lineId]: inflowAmount } : {};
  }

  if (amounts.lineId === 'INPUT_VAT_OUT') {
    return amounts.vatIn > 0 ? { INPUT_VAT_OUT: amounts.vatIn } : {};
  }

  const primaryOutAmount = amounts.expenseAmount > 0
    ? amounts.expenseAmount
    : amounts.depositAmount > 0 || amounts.refundAmount > 0
      ? 0
      : amounts.bankAmount;
  const result: Partial<Record<string, number>> = {};
  if (primaryOutAmount > 0) result[amounts.lineId] = primaryOutAmount;
  if (amounts.vatIn > 0) result.INPUT_VAT_OUT = (result.INPUT_VAT_OUT || 0) + amounts.vatIn;
  return result;
}

export function resolveSettlementBudgetActualAmount(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): number {
  const amounts = resolveSettlementRowFlowAmounts(row, indexes);
  if (amounts.lineId && CASHFLOW_IN_LINE_IDS.has(amounts.lineId)) return 0;
  if (amounts.lineId === 'INPUT_VAT_OUT') return amounts.vatIn;
  if (amounts.expenseAmount > 0) return amounts.expenseAmount;
  if (amounts.vatIn > 0 && amounts.bankAmount === 0) return amounts.vatIn;
  if (amounts.depositAmount > 0 || amounts.refundAmount > 0) return 0;
  return amounts.bankAmount;
}
