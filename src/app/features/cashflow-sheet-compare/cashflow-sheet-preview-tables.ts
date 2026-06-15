import type {
  CashflowSheetLabPreviewResult,
  CashflowSheetLabPreviewValue,
} from '../../lib/sheets-cashflow-readonly-client';

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
      return { ...line, cells };
    });
    const inRows = rows.filter((row) => row.direction === 'IN');
    const outRows = rows.filter((row) => row.direction === 'OUT');
    const sumRows = (targetRows: typeof rows, index: number) => targetRows.reduce((total, row) => (
      total + (row.cells[index]?.displayAmount || 0)
    ), 0);
    const totalIn = weeks.map((_, index) => sumRows(inRows, index));
    const totalOut = weeks.map((_, index) => sumRows(outRows, index));
    let runningBalance = 0;
    const balances = weeks.map((_, index) => {
      runningBalance += totalIn[index] - totalOut[index];
      return runningBalance;
    });
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
      balances,
      nonEmptyCellCount,
    };
  });
}
