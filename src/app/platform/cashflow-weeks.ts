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

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startOfWeekMonday(isoDate: string): string {
  const [yRaw, mRaw, dRaw] = isoDate.split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const dow = dayOfWeekUtc(year, month, day); // 0..6, Sunday=0
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysUtc(isoDate, delta);
}

function countDaysInMonthForWeek(weekStart: string, year: number, month: number): number {
  let count = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysUtc(weekStart, i);
    const [yy, mm] = date.split('-');
    if (Number.parseInt(yy, 10) === year && Number.parseInt(mm, 10) === month) count += 1;
  }
  return count;
}

/**
 * Month week buckets used by the finance sheet:
 * - Weeks are Monday..Sunday.
 * - ISO-like month rule: a week belongs to the month if it contains 4+ days of that month.
 *   (week 1 = week containing the first Thursday of the month)
 */
export function getMonthMondayWeeks(yearMonth: string): MonthMondayWeek[] {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];

  const { year, month } = parsed;
  const firstDay = formatIsoDate(year, month, 1);
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  let weekStart = startOfWeekMonday(firstDay);
  const weeks: MonthMondayWeek[] = [];
  const yy = year % 100;
  let weekNo = 0;

  while (weekStart <= lastDay) {
    const daysInMonth = countDaysInMonthForWeek(weekStart, year, month);
    if (daysInMonth >= 4) {
      weekNo += 1;
      const weekEnd = addDaysUtc(weekStart, 6);
      const label = `${yy}-${month}-${weekNo}`;
      weeks.push({ yearMonth, weekNo, weekStart, weekEnd, label });
    }
    weekStart = addDaysUtc(weekStart, 7);
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
  const direct = weeks.find((w) => dateStr >= w.weekStart && dateStr <= w.weekEnd);
  if (direct) return direct;

  // Fallback: compute week bucket by month rule (handles edge days belonging to prev/next month)
  const [yRaw, mRaw] = dateStr.split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;

  const current = getMonthMondayWeeks(`${year}-${pad2(month)}`);
  const inCurrent = current.find((w) => dateStr >= w.weekStart && dateStr <= w.weekEnd);
  if (inCurrent) return inCurrent;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prev = getMonthMondayWeeks(`${prevYear}-${pad2(prevMonth)}`);
  const inPrev = prev.find((w) => dateStr >= w.weekStart && dateStr <= w.weekEnd);
  if (inPrev) return inPrev;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const next = getMonthMondayWeeks(`${nextYear}-${pad2(nextMonth)}`);
  return next.find((w) => dateStr >= w.weekStart && dateStr <= w.weekEnd);
}
