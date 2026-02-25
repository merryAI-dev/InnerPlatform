import type { Transaction } from '../data/types';

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
