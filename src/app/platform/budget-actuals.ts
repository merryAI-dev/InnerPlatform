import type { Transaction } from '../data/types';
import { buildBudgetLabelKey } from './budget-labels';
import { SETTLEMENT_COLUMNS, type ImportRow } from './settlement-csv';
import {
  resolveSettlementFlowSnapshot,
  type SettlementFlowAmountIndexes,
} from './settlement-flow-amounts';

function getSettlementColumnIndex(header: string): number {
  return SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
}

export function aggregateBudgetActualsFromSettlementRows(
  rows: ImportRow[] | null | undefined,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!rows || rows.length === 0) return result;

  const indexes: SettlementFlowAmountIndexes & {
    budgetCodeIdx: number;
    subCodeIdx: number;
  } = {
    budgetCodeIdx: getSettlementColumnIndex('비목'),
    subCodeIdx: getSettlementColumnIndex('세목'),
    cashflowIdx: getSettlementColumnIndex('cashflow항목'),
    bankAmountIdx: getSettlementColumnIndex('통장에 찍힌 입/출금액'),
    expenseAmountIdx: getSettlementColumnIndex('사업비 사용액'),
    vatInIdx: getSettlementColumnIndex('매입부가세'),
    depositIdx: getSettlementColumnIndex('입금액(사업비,공급가액,은행이자)'),
    refundIdx: getSettlementColumnIndex('매입부가세 반환'),
  };

  if (indexes.budgetCodeIdx < 0 || indexes.subCodeIdx < 0) return result;

  for (const row of rows) {
    const budgetCode = String(row.cells[indexes.budgetCodeIdx] || '');
    const subCode = String(row.cells[indexes.subCodeIdx] || '');
    const key = buildBudgetLabelKey(budgetCode, subCode);
    if (key === '|') continue;
    const amount = resolveSettlementFlowSnapshot(row, indexes).budgetActualAmount;
    if (amount === 0) continue;
    result.set(key, (result.get(key) || 0) + amount);
  }

  return result;
}

export function getTotalBudgetActualFromSettlementRows(
  rows: ImportRow[] | null | undefined,
): number {
  let total = 0;
  for (const amount of aggregateBudgetActualsFromSettlementRows(rows).values()) {
    total += amount;
  }
  return total;
}

/**
 * APPROVED + OUT 거래를 budgetCategory(비목)별 합산
 */
export function aggregateActualsByCategory(
  transactions: Transaction[],
  projectId: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.projectId !== projectId) continue;
    if (tx.state !== 'APPROVED') continue;
    if (tx.direction !== 'OUT') continue;
    const cat = tx.budgetCategory || tx.cashflowLabel || '미분류';
    result[cat] = (result[cat] || 0) + tx.amounts.bankAmount;
  }
  return result;
}

/**
 * 프로젝트별 총 집행액 (APPROVED + OUT)
 */
export function getTotalActual(
  transactions: Transaction[],
  projectId: string,
): number {
  let total = 0;
  for (const tx of transactions) {
    if (tx.projectId !== projectId) continue;
    if (tx.state !== 'APPROVED') continue;
    if (tx.direction !== 'OUT') continue;
    total += tx.amounts.bankAmount;
  }
  return total;
}

/**
 * 소진율 계산 (0-1 범위, budget이 0이면 0 반환)
 */
export function computeBurnRate(budget: number, actual: number): number {
  if (budget <= 0) return 0;
  return actual / budget;
}
