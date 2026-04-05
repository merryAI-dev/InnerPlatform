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

export interface SettlementFlowSnapshot extends SettlementRowFlowAmounts {
  cashflowActualLineAmounts: Partial<Record<string, number>>;
  budgetActualAmount: number;
  manualOutflowPending: boolean;
  reviewRequired: boolean;
}

function parseAmount(cells: string[], index: number): number {
  if (index < 0) return 0;
  return parseNumber(cells[index] || '') ?? 0;
}

function isBankImportedExpenseRow(row: ImportRow): boolean {
  return String(row.sourceTxId || '').startsWith('bank:') && row.entryKind === 'EXPENSE';
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

export function resolveSettlementFlowSnapshot(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): SettlementFlowSnapshot {
  const amounts = resolveSettlementRowFlowAmounts(row, indexes);
  const reviewRequired = row.reviewStatus === 'pending' || (row.reviewHints?.length || 0) > 0;
  const isInflowLine = Boolean(amounts.lineId && CASHFLOW_IN_LINE_IDS.has(amounts.lineId));
  const manualOutflowPending = isBankImportedExpenseRow(row) && (
    !amounts.lineId
    || (
      amounts.lineId === 'INPUT_VAT_OUT'
        ? amounts.vatIn <= 0
        : !isInflowLine && amounts.expenseAmount <= 0
    )
  );

  if (manualOutflowPending) {
    return {
      ...amounts,
      cashflowActualLineAmounts: {},
      budgetActualAmount: 0,
      manualOutflowPending,
      reviewRequired,
    };
  }

  if (!amounts.lineId) {
    return {
      ...amounts,
      cashflowActualLineAmounts: {},
      budgetActualAmount: 0,
      manualOutflowPending,
      reviewRequired,
    };
  }

  let cashflowActualLineAmounts: Partial<Record<string, number>> = {};
  if (isInflowLine) {
    const inflowAmount = amounts.depositAmount > 0
      ? amounts.depositAmount
      : amounts.refundAmount > 0
        ? amounts.refundAmount
        : amounts.bankAmount;
    cashflowActualLineAmounts = inflowAmount > 0 ? { [amounts.lineId]: inflowAmount } : {};
  } else if (amounts.lineId === 'INPUT_VAT_OUT') {
    cashflowActualLineAmounts = amounts.vatIn > 0 ? { INPUT_VAT_OUT: amounts.vatIn } : {};
  } else {
    const primaryOutAmount = amounts.expenseAmount > 0
      ? amounts.expenseAmount
      : amounts.depositAmount > 0 || amounts.refundAmount > 0
        ? 0
        : amounts.bankAmount;
    if (primaryOutAmount > 0) cashflowActualLineAmounts[amounts.lineId] = primaryOutAmount;
    if (amounts.vatIn > 0) {
      cashflowActualLineAmounts.INPUT_VAT_OUT = (cashflowActualLineAmounts.INPUT_VAT_OUT || 0) + amounts.vatIn;
    }
  }

  let budgetActualAmount = 0;
  if (isInflowLine) {
    budgetActualAmount = 0;
  } else if (amounts.lineId === 'INPUT_VAT_OUT') {
    budgetActualAmount = amounts.vatIn;
  } else if (amounts.expenseAmount > 0) {
    budgetActualAmount = amounts.expenseAmount;
  } else if (amounts.vatIn > 0 && amounts.bankAmount === 0) {
    budgetActualAmount = amounts.vatIn;
  } else if (amounts.depositAmount > 0 || amounts.refundAmount > 0) {
    budgetActualAmount = 0;
  } else {
    budgetActualAmount = amounts.bankAmount;
  }

  return {
    ...amounts,
    cashflowActualLineAmounts,
    budgetActualAmount,
    manualOutflowPending,
    reviewRequired,
  };
}

export function resolveSettlementActualSyncAmount(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): number {
  const snapshot = resolveSettlementFlowSnapshot(row, indexes);
  const lineId = snapshot.lineId;
  if (!lineId) return 0;
  return snapshot.cashflowActualLineAmounts[lineId] || 0;
}

export function resolveSettlementCashflowActualLineAmounts(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): Partial<Record<string, number>> {
  return resolveSettlementFlowSnapshot(row, indexes).cashflowActualLineAmounts;
}

export function resolveSettlementBudgetActualAmount(
  row: ImportRow,
  indexes: SettlementFlowAmountIndexes,
): number {
  return resolveSettlementFlowSnapshot(row, indexes).budgetActualAmount;
}
