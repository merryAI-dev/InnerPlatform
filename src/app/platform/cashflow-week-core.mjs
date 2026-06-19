function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidYearMonth(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return false;
  const [, mmRaw] = trimmed.split('-');
  const mm = Number.parseInt(mmRaw, 10);
  return Number.isFinite(mm) && mm >= 1 && mm <= 12;
}

function parseYearMonth(value) {
  if (!isValidYearMonth(value)) return null;
  const [yyyyRaw, mmRaw] = value.trim().split('-');
  const year = Number.parseInt(yyyyRaw, 10);
  const month = Number.parseInt(mmRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month, yearMonth: `${String(year).padStart(4, '0')}-${pad2(month)}` };
}

function formatIsoDate(year, month, day) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate, deltaDays) {
  const [yRaw, mRaw, dRaw] = String(isoDate || '').split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const base = Date.UTC(year, month - 1, day);
  const next = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
  return formatIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function dayOfWeekUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startOfWeekMonday(isoDate) {
  const [yRaw, mRaw, dRaw] = String(isoDate || '').split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const dow = dayOfWeekUtc(year, month, day);
  const delta = -((dow + 6) % 7);
  return addDaysUtc(isoDate, delta);
}

function parseIsoDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  const lastDay = daysInMonthUtc(year, month);
  if (day < 1 || day > lastDay) return null;
  return { year, month, day, yearMonth: `${String(year).padStart(4, '0')}-${pad2(month)}` };
}

function rawWeekForMonthDate(year, month, day) {
  const firstDow = dayOfWeekUtc(year, month, 1);
  const firstDayOffsetFromMonday = (firstDow + 6) % 7;
  return Math.floor((firstDayOffsetFromMonday + day - 1) / 7) + 1;
}

function buildWeek(year, month, rawWeek) {
  const yearMonth = `${String(year).padStart(4, '0')}-${pad2(month)}`;
  const firstDay = formatIsoDate(year, month, 1);
  const firstWeekStart = startOfWeekMonday(firstDay);
  const financeWeek = Math.max(1, Math.min(5, rawWeek));
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  const weekStart = financeWeek === 1
    ? firstDay
    : addDaysUtc(firstWeekStart, (financeWeek - 1) * 7);
  const weekEnd = financeWeek === 5
    ? lastDay
    : addDaysUtc(firstWeekStart, financeWeek * 7 - 1);
  return {
    financeYear: year,
    financeMonth: month,
    rawWeek,
    financeWeek,
    yearMonth,
    weekNo: financeWeek,
    weekStart,
    weekEnd,
    label: `${year % 100}-${month}-${financeWeek}`,
  };
}

export function isYearMonth(value) {
  return isValidYearMonth(value);
}

export function resolveFinanceWeekForDate(dateStr) {
  const parsed = parseIsoDateOnly(dateStr);
  if (!parsed) return undefined;
  const rawWeek = rawWeekForMonthDate(parsed.year, parsed.month, parsed.day);
  return buildWeek(parsed.year, parsed.month, rawWeek);
}

export function getMonthFinanceWeeks(yearMonth) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];

  const weeks = [];
  for (let rawWeek = 1; rawWeek <= 5; rawWeek += 1) {
    weeks.push(buildWeek(parsed.year, parsed.month, rawWeek));
  }

  const rawWeekForLastDay = rawWeekForMonthDate(parsed.year, parsed.month, daysInMonthUtc(parsed.year, parsed.month));
  if (rawWeekForLastDay > 5) {
    const rawSix = buildWeek(parsed.year, parsed.month, rawWeekForLastDay);
    weeks[4] = {
      ...weeks[4],
      rawWeek: rawWeekForLastDay,
      weekEnd: rawSix.weekEnd,
    };
  }

  return weeks;
}

export function getYearFinanceWeeks(year) {
  const parsedYear = Number.parseInt(String(year), 10);
  if (!Number.isFinite(parsedYear)) return [];
  const all = [];
  for (let m = 1; m <= 12; m += 1) {
    all.push(...getMonthFinanceWeeks(`${parsedYear}-${pad2(m)}`));
  }
  return all;
}

export function findFinanceWeekForDate(dateStr, weeks = []) {
  const resolved = resolveFinanceWeekForDate(dateStr);
  if (!resolved) return undefined;
  return weeks.find((week) => (
    week.yearMonth === resolved.yearMonth
    && Number(week.weekNo) === resolved.weekNo
  )) || resolved;
}
