import type {
  CashflowSettlementPeriod,
  CashflowSettlementStatusItem,
  CashflowSettlementStatusesResult,
} from '../lib/platform-bff-client';
import { addDays } from './business-days';
import { resolveFinanceWeekForDate } from './cashflow-weeks';

export interface CashflowExportRecentWeek {
  yearMonth: string;
  weekNo: number;
  period: CashflowSettlementPeriod;
  displayLabel: string;
}

export function resolveCashflowExportRecentWeeks(todayIso: string): CashflowExportRecentWeek[] {
  const current = resolveFinanceWeekForDate(todayIso);
  if (!current) return [];
  const previous = resolveFinanceWeekForDate(addDays(current.weekStart, -1));
  if (!previous) return [];
  return [previous, current].map((week) => ({
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
    period: `WEEK_${week.weekNo}` as CashflowSettlementPeriod,
    displayLabel: `${week.financeMonth}월 ${week.weekNo}주차`,
  }));
}

export function chunkCashflowExportProjectIds(projectIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < projectIds.length; index += 100) {
    chunks.push(projectIds.slice(index, index + 100));
  }
  return chunks;
}

export function findCashflowExportSettlementStatus(
  results: CashflowSettlementStatusesResult[],
  projectId: string,
  week: CashflowExportRecentWeek,
): CashflowSettlementStatusItem | null {
  const projectResults = results.filter((result) => (
    result.projectId === projectId && result.yearMonth === week.yearMonth
  ));
  if (projectResults.length !== 1) return null;
  const statuses = projectResults[0].items.filter((item) => item.period === week.period);
  return statuses.length === 1 ? statuses[0] : null;
}
