import type { Transaction } from '../data/types';
import { buildBudgetLabelKey } from './budget-labels';
import type { ImportRow } from './settlement-csv';
import {
  getSettlementFlowAmountIndexes,
  resolveSettlementFlowSnapshot,
  type SettlementFlowSnapshot,
} from './settlement-flow-amounts';

type SettlementBudgetActualSnapshot = Pick<SettlementFlowSnapshot, 'budgetKey' | 'budgetCode' | 'subCode' | 'budgetActualAmount'>;

export function aggregateBudgetActualsFromSettlementFlowSnapshots(
  snapshots: Iterable<SettlementBudgetActualSnapshot> | null | undefined,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!snapshots) return result;

  for (const snapshot of snapshots) {
    const key = snapshot.budgetKey || buildBudgetLabelKey(snapshot.budgetCode || '', snapshot.subCode || '');
    if (key === '|') continue;
    if (snapshot.budgetActualAmount === 0) continue;
    result.set(key, (result.get(key) || 0) + snapshot.budgetActualAmount);
  }

  return result;
}

export function aggregateBudgetActualsFromSettlementRows(
  rows: ImportRow[] | null | undefined,
): Map<string, number> {
  if (!rows || rows.length === 0) return new Map<string, number>();
  const indexes = getSettlementFlowAmountIndexes();
  return aggregateBudgetActualsFromSettlementFlowSnapshots(
    rows.map((row) => resolveSettlementFlowSnapshot(row, indexes)),
  );
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
