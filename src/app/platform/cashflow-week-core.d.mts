export interface FinanceWeek {
  financeYear: number;
  financeMonth: number;
  rawWeek: number;
  financeWeek: number;
  yearMonth: string;
  weekNo: number;
  weekStart: string;
  weekEnd: string;
  label: string;
}

export function isYearMonth(value: unknown): value is string;
export function resolveFinanceWeekForDate(dateStr: string): FinanceWeek | undefined;
export function getMonthFinanceWeeks(yearMonth: string): FinanceWeek[];
export function getYearFinanceWeeks(year: number): FinanceWeek[];
export function findFinanceWeekForDate<T extends Pick<FinanceWeek, 'yearMonth' | 'weekNo'>>(
  dateStr: string,
  weeks?: T[],
): T | FinanceWeek | undefined;
