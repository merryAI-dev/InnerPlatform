import type {
  CashflowSheetLabPreviewResult,
  CashflowSheetLabPreviewValue,
} from '../../lib/sheets-cashflow-readonly-client';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';

export function parseCashflowSheetDisplayAmount(value: string) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return null;
  const normalizedMinus = raw.replace(/[−–—]/g, '-');
  const parenthesizedNegative = /^\s*\(.*\)\s*$/.test(normalizedMinus);
  let cleaned = normalizedMinus
    .replace(/[,\s\u00a0원₩￦]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^0-9.+-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+') return null;
  if (cleaned.endsWith('-') && cleaned.length > 1) {
    cleaned = `-${cleaned.slice(0, -1)}`;
  }
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return parenthesizedNegative && parsed > 0 ? -parsed : parsed;
}

export function formatCashflowSheetWeekKey(yearMonth: string, weekNo: number) {
  return `${yearMonth}:W${weekNo}`;
}

export function formatCashflowSheetLabel(yearMonth: string, weekNo: number) {
  const year = Number.parseInt(yearMonth.slice(2, 4), 10);
  const month = Number.parseInt(yearMonth.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return formatCashflowSheetWeekKey(yearMonth, weekNo);
  return `${year}-${month}-${weekNo}`;
}

function isCanonicalWeek(yearMonth: string, weekNo: number) {
  return getMonthMondayWeeks(yearMonth).some((week) => week.weekNo === Number(weekNo));
}

function previewValueKey(value: Pick<CashflowSheetLabPreviewValue, 'mode' | 'lineId' | 'yearMonth' | 'weekNo'>) {
  return `${value.mode}:${value.lineId}:${formatCashflowSheetWeekKey(value.yearMonth, value.weekNo)}`;
}

function compareWeekLike(
  a: Pick<CashflowSheetLabPreviewValue, 'yearMonth' | 'weekNo'>,
  b: Pick<CashflowSheetLabPreviewValue, 'yearMonth' | 'weekNo'>,
) {
  return a.yearMonth.localeCompare(b.yearMonth) || a.weekNo - b.weekNo;
}

export function selectPreviewAmount(value: CashflowSheetLabPreviewValue | undefined) {
  if (!value) return { sheetAmount: null, reflectedAmount: null, displayAmount: null, diff: null };
  const sheetAmount = parseCashflowSheetDisplayAmount(value.sheetValue);
  const reflectedAmount = value.amount;
  const displayAmount = sheetAmount;
  const diff = typeof reflectedAmount === 'number' && typeof sheetAmount === 'number'
    ? reflectedAmount - sheetAmount
    : null;
  return { sheetAmount, reflectedAmount, displayAmount, diff };
}

export function buildCashflowPreviewTables(preview: CashflowSheetLabPreviewResult | null) {
  if (!preview) return [];
  const valueIndex = new Map<string, CashflowSheetLabPreviewValue>();
  const weeksByMode = new Map<string, Map<string, Pick<CashflowSheetLabPreviewValue, 'yearMonth' | 'weekNo'>>>();

  for (const value of preview.previewValues) {
    valueIndex.set(previewValueKey(value), value);
    const modeWeeks = weeksByMode.get(value.mode) || new Map();
    modeWeeks.set(formatCashflowSheetWeekKey(value.yearMonth, value.weekNo), {
      yearMonth: value.yearMonth,
      weekNo: value.weekNo,
    });
    weeksByMode.set(value.mode, modeWeeks);
  }

  return preview.template.sections.map((section) => {
    const weeks = Array.from(weeksByMode.get(section.mode)?.values() || [])
      .sort(compareWeekLike);
    const rows = section.lineRows.map((line) => {
      const cells = weeks.map((week) => {
        const value = valueIndex.get(previewValueKey({
          mode: section.mode,
          lineId: line.lineId,
          yearMonth: week.yearMonth,
          weekNo: week.weekNo,
        }));
        return {
          ...week,
          a1: value?.a1 || '',
          sheetValue: value?.sheetValue || '',
          ...selectPreviewAmount(value),
        };
      });
      const sheetTotal = cells.reduce((total, cell) => total + (cell.sheetAmount || 0), 0);
      const reflectedTotal = cells.reduce((total, cell) => total + (cell.reflectedAmount || 0), 0);
      return {
        ...line,
        cells,
        sheetTotal,
        reflectedTotal,
        diffTotal: reflectedTotal - sheetTotal,
      };
    });
    const inRows = rows.filter((row) => row.direction === 'IN');
    const outRows = rows.filter((row) => row.direction === 'OUT');
    const sumRows = (targetRows: typeof rows, index: number, source: 'sheetAmount' | 'reflectedAmount') => targetRows.reduce((total, row) => (
      total + (row.cells[index]?.[source] || 0)
    ), 0);
    const totalIn = weeks.map((_, index) => sumRows(inRows, index, 'sheetAmount'));
    const totalOut = weeks.map((_, index) => sumRows(outRows, index, 'sheetAmount'));
    const reflectedTotalIn = weeks.map((_, index) => sumRows(inRows, index, 'reflectedAmount'));
    const reflectedTotalOut = weeks.map((_, index) => sumRows(outRows, index, 'reflectedAmount'));
    let runningBalance = 0;
    const balances = weeks.map((_, index) => {
      runningBalance += totalIn[index] - totalOut[index];
      return runningBalance;
    });
    let reflectedRunningBalance = 0;
    const reflectedBalances = weeks.map((_, index) => {
      reflectedRunningBalance += reflectedTotalIn[index] - reflectedTotalOut[index];
      return reflectedRunningBalance;
    });
    const invalidWeeks = weeks
      .filter((week) => !isCanonicalWeek(week.yearMonth, week.weekNo))
      .map((week) => formatCashflowSheetLabel(week.yearMonth, week.weekNo));
    const nonEmptyCellCount = rows.reduce((count, row) => count + row.cells.filter((cell) => (
      typeof cell.sheetAmount === 'number'
      || cell.sheetValue.trim()
    )).length, 0);
    return {
      mode: section.mode,
      weeks,
      inRows,
      outRows,
      totalIn,
      totalOut,
      reflectedTotalIn,
      reflectedTotalOut,
      balances,
      reflectedBalances,
      invalidWeeks,
      sheetIncomeTotal: totalIn.reduce((sum, amount) => sum + amount, 0),
      sheetExpenseTotal: totalOut.reduce((sum, amount) => sum + amount, 0),
      reflectedIncomeTotal: reflectedTotalIn.reduce((sum, amount) => sum + amount, 0),
      reflectedExpenseTotal: reflectedTotalOut.reduce((sum, amount) => sum + amount, 0),
      nonEmptyCellCount,
    };
  });
}
