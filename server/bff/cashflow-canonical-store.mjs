import cashflowPolicyData from '../../src/app/policies/cashflow-policy.json' with { type: 'json' };
import { CASHFLOW_IN_LINES } from './cashflow-policy.mjs';

const SETTLEMENT_COLUMN_HEADERS = [
  '작성자',
  'No.',
  '거래일시',
  '해당 주차',
  '지출구분',
  '비목',
  '세목',
  '세세목',
  'cashflow항목',
  '통장잔액',
  '통장에 찍힌 입/출금액',
  '입금액(사업비,공급가액,은행이자)',
  '매입부가세 반환',
  '사업비 사용액',
  '매입부가세',
];

const COLUMN_INDEX = Object.fromEntries(SETTLEMENT_COLUMN_HEADERS.map((header, index) => [header, index]));
const CASHFLOW_IN_LINE_IDS = new Set(CASHFLOW_IN_LINES);
const LINE_BY_LABEL = new Map();
function legacyCashflowWriterDisabled() {
  const error = new Error('Legacy cashflow Firestore writer is disabled. Use Java weekly expense ORM commands.');
  error.code = 'legacy_cashflow_writer_disabled';
  error.statusCode = 410;
  return error;
}

function normalizePolicyLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

for (const entry of cashflowPolicyData.lineEntries || []) {
  LINE_BY_LABEL.set(normalizePolicyLabel(entry.lineId), entry.lineId);
  LINE_BY_LABEL.set(normalizePolicyLabel(entry.label), entry.lineId);
  LINE_BY_LABEL.set(normalizePolicyLabel(entry.label).replace(/\s+/g, ''), entry.lineId);
  for (const alias of entry.aliases || []) {
    LINE_BY_LABEL.set(normalizePolicyLabel(alias), entry.lineId);
    LINE_BY_LABEL.set(normalizePolicyLabel(alias).replace(/\s+/g, ''), entry.lineId);
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseYearMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
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

function startOfWeekWednesday(isoDate) {
  const [yRaw, mRaw, dRaw] = String(isoDate || '').split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const dow = dayOfWeekUtc(year, month, day);
  const delta = -((dow - 3 + 7) % 7);
  return addDaysUtc(isoDate, delta);
}

function countDaysInMonthForWeek(weekStart, year, month) {
  let count = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysUtc(weekStart, i);
    const [yy, mm] = date.split('-');
    if (Number.parseInt(yy, 10) === year && Number.parseInt(mm, 10) === month) count += 1;
  }
  return count;
}

export function getMonthCashflowWeeks(yearMonth) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];

  const { year, month } = parsed;
  const firstDay = formatIsoDate(year, month, 1);
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  let weekStart = startOfWeekWednesday(firstDay);
  const weeks = [];
  const yy = year % 100;
  let weekNo = 0;

  while (weekStart <= lastDay) {
    const daysInMonth = countDaysInMonthForWeek(weekStart, year, month);
    if (daysInMonth >= 4) {
      weekNo += 1;
      weeks.push({
        yearMonth: parsed.yearMonth,
        weekNo,
        weekStart,
        weekEnd: addDaysUtc(weekStart, 6),
        label: `${yy}-${month}-${weekNo}`,
      });
    }
    weekStart = addDaysUtc(weekStart, 7);
  }

  return weeks;
}

function getYearCashflowWeeks(year) {
  const all = [];
  for (let month = 1; month <= 12; month += 1) {
    all.push(...getMonthCashflowWeeks(`${year}-${pad2(month)}`));
  }
  return all;
}

function findWeekForDate(dateStr, weeks) {
  if (!dateStr) return undefined;
  const direct = weeks.find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
  if (direct) return direct;

  const [yRaw, mRaw] = dateStr.split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;

  const current = getMonthCashflowWeeks(`${year}-${pad2(month)}`);
  const inCurrent = current.find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
  if (inCurrent) return inCurrent;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prev = getMonthCashflowWeeks(`${prevYear}-${pad2(prevMonth)}`);
  const inPrev = prev.find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
  if (inPrev) return inPrev;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return getMonthCashflowWeeks(`${nextYear}-${pad2(nextMonth)}`)
    .find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
}

function resolveWeekFromLabel(label, anchorWeeks) {
  const normalized = String(label || '').trim();
  if (!normalized) return undefined;
  const direct = anchorWeeks.find((week) => week.label === normalized);
  if (direct) return direct;

  const match = /^(\d{2})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!match) return undefined;
  const year = 2000 + Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const weekNo = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return undefined;
  return getMonthCashflowWeeks(`${year}-${pad2(month)}`).find((week) => week.weekNo === weekNo);
}

function parseDateIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (compact) {
    return `${compact[1]}-${pad2(Number.parseInt(compact[2], 10))}-${pad2(Number.parseInt(compact[3], 10))}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function resolveWeekFromRow(row, anchorWeeks) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const explicitLabel = String(cells[COLUMN_INDEX['해당 주차']] || '').trim();
  const fromLabel = resolveWeekFromLabel(explicitLabel, anchorWeeks);
  if (fromLabel) return fromLabel;

  const dateOnly = parseDateIso(cells[COLUMN_INDEX['거래일시']]);
  if (!dateOnly) return undefined;
  const dateYear = Number.parseInt(dateOnly.slice(0, 4), 10);
  const anchorYear = Number.parseInt(anchorWeeks[0]?.yearMonth?.slice(0, 4) || '', 10);
  return findWeekForDate(dateOnly, dateYear === anchorYear ? anchorWeeks : getYearCashflowWeeks(dateYear));
}

export function parseCashflowLineLabel(raw) {
  const normalized = normalizePolicyLabel(raw);
  if (!normalized) return undefined;
  return LINE_BY_LABEL.get(normalized) || LINE_BY_LABEL.get(normalized.replace(/\s+/g, ''));
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const negativeByParens = /^\(.+\)$/.test(raw);
  const sanitized = raw.replace(/[,\s원₩$]/g, '').replace(/[()]/g, '');
  const parsed = Number.parseFloat(sanitized.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  const amount = Math.trunc(parsed);
  return negativeByParens ? -Math.abs(amount) : amount;
}

function rowAmount(row, header) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  return parseAmount(cells[COLUMN_INDEX[header]]);
}

function isBankImportedExpenseRow(row) {
  return String(row?.sourceTxId || '').startsWith('bank:') && row?.entryKind === 'EXPENSE';
}

function resolveActualLineAmounts(row) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const lineId = parseCashflowLineLabel(cells[COLUMN_INDEX['cashflow항목']]);
  if (!lineId) return {};

  const bankAmount = rowAmount(row, '통장에 찍힌 입/출금액');
  const expenseAmount = rowAmount(row, '사업비 사용액');
  const vatIn = rowAmount(row, '매입부가세');
  const depositAmount = rowAmount(row, '입금액(사업비,공급가액,은행이자)');
  const refundAmount = rowAmount(row, '매입부가세 반환');
  const isInflowLine = CASHFLOW_IN_LINE_IDS.has(lineId);
  const manualOutflowPending = isBankImportedExpenseRow(row) && (
    !lineId
    || (
      lineId === 'INPUT_VAT_OUT'
        ? vatIn <= 0
        : !isInflowLine && expenseAmount <= 0
    )
  );

  if (manualOutflowPending) return {};

  if (isInflowLine) {
    const outflowAdjustmentAmount = expenseAmount < 0
      ? expenseAmount
      : row?.entryKind === 'EXPENSE' && depositAmount <= 0 && refundAmount <= 0 && bankAmount > 0
        ? -bankAmount
        : 0;
    const inflowAmount = depositAmount > 0 ? depositAmount : refundAmount > 0 ? refundAmount : bankAmount;
    if (outflowAdjustmentAmount < 0) return { [lineId]: outflowAdjustmentAmount };
    return inflowAmount > 0 ? { [lineId]: inflowAmount } : {};
  }

  if (lineId === 'INPUT_VAT_OUT') {
    return vatIn > 0 ? { INPUT_VAT_OUT: vatIn } : {};
  }

  const amounts = {};
  const primaryOutAmount = expenseAmount > 0
    ? expenseAmount
    : depositAmount > 0 || refundAmount > 0
      ? 0
      : bankAmount;
  if (primaryOutAmount > 0) amounts[lineId] = primaryOutAmount;
  if (vatIn > 0) amounts.INPUT_VAT_OUT = (amounts.INPUT_VAT_OUT || 0) + vatIn;
  return amounts;
}

function weekKey(week) {
  return `${week.yearMonth}:w${week.weekNo}`;
}

function parseWeekKey(key) {
  const match = /^(\d{4}-\d{2}):w(\d+)$/.exec(String(key || ''));
  if (!match) return undefined;
  const weekNo = Number.parseInt(match[2], 10);
  return getMonthCashflowWeeks(match[1]).find((week) => week.weekNo === weekNo);
}

export function buildCashflowActualSyncPlan({ rows, previousWeekKeys = [], anchorYear }) {
  const fallbackYear = Number.isFinite(anchorYear) ? anchorYear : new Date().getFullYear();
  const anchorWeeks = getYearCashflowWeeks(fallbackYear);
  const weekLabels = new Set();
  const byWeek = new Map();

  for (const row of rows || []) {
    const week = resolveWeekFromRow(row, anchorWeeks);
    if (!week) continue;
    const key = weekKey(week);
    weekLabels.add(key);
    const target = byWeek.get(key) || {};
    for (const [lineId, amount] of Object.entries(resolveActualLineAmounts(row))) {
      if (!amount) continue;
      target[lineId] = (target[lineId] || 0) + amount;
    }
    byWeek.set(key, target);
  }

  const payload = Array.from(weekLabels)
    .map((key) => {
      const week = parseWeekKey(key);
      return week ? { ...week, key, amounts: { ...(byWeek.get(key) || {}) } } : null;
    })
    .filter((week) => week && Object.keys(week.amounts || {}).length > 0)
    .filter(Boolean)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.weekNo - b.weekNo);

  return {
    weeks: payload,
    clearedWeeks: [],
    weekKeys: payload.map((week) => week.key),
  };
}

export async function upsertCashflowWeekAmounts({ db, tenantId, actorId, actorName, projectId, mode, yearMonth, weekNo, amounts, now }) {
  throw legacyCashflowWriterDisabled();
}

export async function syncProjectCashflowActualsFromExpenseSheets({ db, tenantId, actorId, actorName, projectId, now }) {
  throw legacyCashflowWriterDisabled();
}
