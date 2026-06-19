import {
  findFinanceWeekForDate,
  getMonthFinanceWeeks,
  getYearFinanceWeeks,
  isYearMonth as isCashflowYearMonth,
  resolveFinanceWeekForDate,
} from './cashflow-week-core.mjs';

export interface MonthMondayWeek {
  financeYear?: number;
  financeMonth?: number;
  rawWeek?: number;
  financeWeek?: number;
  yearMonth: string; // YYYY-MM
  weekNo: number; // 1..5
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string; // YYYY-MM-DD (Sunday, or merged week 5)
  label: string; // e.g. "26-1-4"
}

/**
 * Month week buckets used by the finance sheet:
 * - Weeks are Monday..Sunday calendar rows within the selected finance month.
 * - Cashflow storage and sheet slots are fixed to financeWeek 1..5.
 * - A raw calendar week 6 is merged into financeWeek 5.
 */
export function getMonthMondayWeeks(yearMonth: string): MonthMondayWeek[] {
  return getMonthFinanceWeeks(yearMonth);
}

export function isYearMonth(value: unknown): value is string {
  return isCashflowYearMonth(value);
}

/** All finance weeks for an entire year (Jan..Dec), 60 fixed slots. */
export function getYearMondayWeeks(year: number): MonthMondayWeek[] {
  return getYearFinanceWeeks(year);
}

/** Find which MonthMondayWeek a date (YYYY-MM-DD) falls into. */
export function findWeekForDate(
  dateStr: string,
  weeks: MonthMondayWeek[],
): MonthMondayWeek | undefined {
  return findFinanceWeekForDate(dateStr, weeks);
}

export { resolveFinanceWeekForDate };
