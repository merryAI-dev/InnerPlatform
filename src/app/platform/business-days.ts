function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toUtcDate(date: string): Date {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatIsoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isWeekendUtc(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function subtractBusinessDays(date: string, businessDays: number): string {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new Error(`businessDays must be a non-negative integer (got ${businessDays})`);
  }

  let cursor = toUtcDate(date);
  let remaining = businessDays;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    if (!isWeekendUtc(cursor)) remaining -= 1;
  }
  return formatIsoDateUtc(cursor);
}

export function addDays(date: string, deltaDays: number): string {
  if (!Number.isInteger(deltaDays)) {
    throw new Error(`deltaDays must be an integer (got ${deltaDays})`);
  }
  const cursor = toUtcDate(date);
  const next = new Date(cursor.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  return formatIsoDateUtc(next);
}

export function daysInMonth(year: number, month1to12: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month1to12)) {
    throw new Error('daysInMonth expects integer year/month');
  }
  if (month1to12 < 1 || month1to12 > 12) throw new Error(`Invalid month: ${month1to12}`);
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function clampDayOfMonth(year: number, month1to12: number, dayOfMonth: number): number {
  const last = daysInMonth(year, month1to12);
  const day = Math.max(1, Math.min(last, Math.trunc(dayOfMonth)));
  return day;
}

export function computePlannedPayDate(yearMonth: string, dayOfMonth: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!m) throw new Error(`Invalid yearMonth: ${yearMonth}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = clampDayOfMonth(year, month, dayOfMonth);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addMonthsToYearMonth(yearMonth: string, deltaMonths: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!m) throw new Error(`Invalid yearMonth: ${yearMonth}`);
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const next = new Date(Date.UTC(year, month0 + deltaMonths, 1));
  const nextYear = next.getUTCFullYear();
  const nextMonth = next.getUTCMonth() + 1;
  return `${nextYear}-${pad2(nextMonth)}`;
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getSeoulTodayIso(now: Date = new Date()): string {
  return formatDateInTimeZone(now, 'Asia/Seoul');
}
