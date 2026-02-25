function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidYearMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return false;
  const [, mmRaw] = trimmed.split('-');
  const mm = Number.parseInt(mmRaw, 10);
  return Number.isFinite(mm) && mm >= 1 && mm <= 12;
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  if (!isValidYearMonth(value)) return null;
  const [yyyyRaw, mmRaw] = value.trim().split('-');
  const year = Number.parseInt(yyyyRaw, 10);
  const month = Number.parseInt(mmRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate: string, deltaDays: number): string {
  const [yRaw, mRaw, dRaw] = isoDate.split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const base = Date.UTC(year, month - 1, day);
  const next = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
  return formatIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function dayOfWeekUtc(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export interface MonthMondayWeek {
  yearMonth: string; // YYYY-MM
  weekNo: number; // 1..5
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string; // YYYY-MM-DD (Sunday)
  label: string; // e.g. "26-1-4"
}

/**
 * Month week buckets used by the finance sheet:
 * - Weeks are Monday..Sunday.
 * - The week number is "nth Monday in the month".
 *   Example: 2026-01 has Mondays on 01-05/12/19/26 => weekNo 1..4.
 */
export function getMonthMondayWeeks(yearMonth: string): MonthMondayWeek[] {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];

  const { year, month } = parsed;

  let firstMondayDay = 0;
  for (let d = 1; d <= 7; d += 1) {
    if (dayOfWeekUtc(year, month, d) === 1) {
      firstMondayDay = d;
      break;
    }
  }

  if (!firstMondayDay) {
    // Should be impossible, but guard anyway.
    return [];
  }

  const weeks: MonthMondayWeek[] = [];
  const yy = year % 100;

  for (let i = 0, day = firstMondayDay; i < 6; i += 1, day += 7) {
    // Stop when we pass the month boundary.
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() + 1 !== month) break;

    const weekNo = i + 1;
    const weekStart = formatIsoDate(year, month, day);
    const weekEnd = addDaysUtc(weekStart, 6);
    const label = `${yy}-${month}-${weekNo}`;
    weeks.push({ yearMonth, weekNo, weekStart, weekEnd, label });
  }

  return weeks;
}

export function isYearMonth(value: unknown): value is string {
  return isValidYearMonth(value);
}

/** All Monday-based weeks for an entire year (Jan..Dec), ~48-53 weeks. */
export function getYearMondayWeeks(year: number): MonthMondayWeek[] {
  const all: MonthMondayWeek[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${pad2(m)}`;
    all.push(...getMonthMondayWeeks(ym));
  }
  return all;
}

/** Find which MonthMondayWeek a date (YYYY-MM-DD) falls into. */
export function findWeekForDate(
  dateStr: string,
  weeks: MonthMondayWeek[],
): MonthMondayWeek | undefined {
  if (!dateStr) return undefined;
  return weeks.find((w) => dateStr >= w.weekStart && dateStr <= w.weekEnd);
}
