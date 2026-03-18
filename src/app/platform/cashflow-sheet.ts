import type { CashflowCategory, CashflowSheetLineId, Direction, Transaction } from '../data/types';
import type { MonthMondayWeek } from './cashflow-weeks';

export const CASHFLOW_IN_LINES: CashflowSheetLineId[] = [
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
];

export const CASHFLOW_OUT_LINES: CashflowSheetLineId[] = [
  'DIRECT_COST_OUT',
  'INPUT_VAT_OUT',
  'MYSC_LABOR_OUT',
  'MYSC_PROFIT_OUT',
  'SALES_VAT_OUT',
  'TEAM_SUPPORT_OUT',
  'BANK_INTEREST_OUT',
];

export const CASHFLOW_ALL_LINES: CashflowSheetLineId[] = [...CASHFLOW_IN_LINES, ...CASHFLOW_OUT_LINES];

export interface CashflowTotals {
  totalIn: number;
  totalOut: number;
  net: number;
}

export function computeCashflowTotals(
  sheet: Partial<Record<CashflowSheetLineId, number>> | undefined,
): CashflowTotals {
  const src = sheet || {};

  const totalIn = CASHFLOW_IN_LINES.reduce((acc, id) => acc + (Number(src[id]) || 0), 0);
  const totalOut = CASHFLOW_OUT_LINES.reduce((acc, id) => acc + (Number(src[id]) || 0), 0);
  return { totalIn, totalOut, net: totalIn - totalOut };
}

export function hasAnyCashflowKeys(sheet: Partial<Record<CashflowSheetLineId, number>> | undefined): boolean {
  return !!sheet && Object.keys(sheet).length > 0;
}

export function chooseCashflowSheetForNet(input: {
  actual: Partial<Record<CashflowSheetLineId, number>> | undefined;
  projection: Partial<Record<CashflowSheetLineId, number>> | undefined;
}): { source: 'actual' | 'projection'; sheet: Partial<Record<CashflowSheetLineId, number>> } {
  if (hasAnyCashflowKeys(input.actual)) return { source: 'actual', sheet: input.actual || {} };
  return { source: 'projection', sheet: input.projection || {} };
}

// ── Transaction → CashflowSheetLineId 매핑 ──

/**
 * CashflowCategory + Direction → primary CashflowSheetLineId
 *
 * IN 방향:
 *   계약금/중도금/잔금 → SALES_IN (매출액 입금)
 *   부가세환급 → SALES_VAT_IN
 *   기타수입 → BANK_INTEREST_IN
 *
 * OUT 방향:
 *   인건비 → MYSC_LABOR_OUT
 *   세금납부 → SALES_VAT_OUT
 *   나머지(외주비/장비/출장/소모품 등) → DIRECT_COST_OUT
 */
export function mapCategoryToSheetLine(
  direction: Direction,
  category: CashflowCategory,
): CashflowSheetLineId {
  if (direction === 'IN') {
    switch (category) {
      case 'CONTRACT_PAYMENT':
      case 'INTERIM_PAYMENT':
      case 'FINAL_PAYMENT':
        return 'SALES_IN';
      case 'VAT_REFUND':
        return 'SALES_VAT_IN';
      case 'MISC_INCOME':
        return 'BANK_INTEREST_IN';
      default:
        return 'SALES_IN';
    }
  }
  // OUT
  switch (category) {
    case 'LABOR_COST':
      return 'MYSC_LABOR_OUT';
    case 'TAX_PAYMENT':
      return 'SALES_VAT_OUT';
    default:
      return 'DIRECT_COST_OUT';
  }
}

/**
 * 트랜잭션 배열을 주차별 CashflowSheetLineId 금액으로 집계.
 * DRAFT/REJECTED 상태는 제외. VAT는 별도 라인(INPUT_VAT_OUT / SALES_VAT_IN)으로 분리.
 */
export function aggregateTransactionsToActual(
  transactions: Transaction[],
  monthWeeks: MonthMondayWeek[],
): Map<number, Partial<Record<CashflowSheetLineId, number>>> {
  const result = new Map<number, Partial<Record<CashflowSheetLineId, number>>>();
  for (const def of monthWeeks) {
    result.set(def.weekNo, {});
  }

  for (const tx of transactions) {
    // DRAFT/REJECTED 제외 — SUBMITTED + APPROVED만 반영
    if (tx.state === 'DRAFT' || tx.state === 'REJECTED') continue;

    // 해당 월/주차에 속하는 거래만 필터
    const weekDef = monthWeeks.find(
      (w) => tx.dateTime >= w.weekStart && tx.dateTime <= w.weekEnd,
    );
    if (!weekDef) continue;

    const lineId = mapCategoryToSheetLine(tx.direction, tx.cashflowCategory);
    const bucket = result.get(weekDef.weekNo)!;

    if (tx.direction === 'IN') {
      // 매출액: 입금액 - 매출부가세
      const primaryAmount = tx.amounts.depositAmount - tx.amounts.vatOut;
      bucket[lineId] = (bucket[lineId] || 0) + primaryAmount;
      // 매출부가세 → SALES_VAT_IN
      if (tx.amounts.vatOut > 0) {
        bucket.SALES_VAT_IN = (bucket.SALES_VAT_IN || 0) + tx.amounts.vatOut;
      }
    } else {
      // 직접비: 출금액 - 매입부가세
      const primaryAmount = tx.amounts.expenseAmount - tx.amounts.vatIn;
      bucket[lineId] = (bucket[lineId] || 0) + primaryAmount;
      // 매입부가세 → INPUT_VAT_OUT
      if (tx.amounts.vatIn > 0) {
        bucket.INPUT_VAT_OUT = (bucket.INPUT_VAT_OUT || 0) + tx.amounts.vatIn;
      }
    }
  }

  return result;
}

