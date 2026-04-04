import { parseDate } from './csv-utils';
import { CASHFLOW_ALL_LINES } from './cashflow-sheet';
import { findWeekForDate, getMonthMondayWeeks, getYearMondayWeeks, type MonthMondayWeek } from './cashflow-weeks';
import {
  parseCashflowLineLabel,
  SETTLEMENT_COLUMNS,
  type ImportRow,
} from './settlement-csv';
import { resolveSettlementCashflowActualLineAmounts, type SettlementFlowAmountIndexes } from './settlement-flow-amounts';

export interface SettlementActualSyncWeekPayload {
  yearMonth: string;
  weekNo: number;
  amounts: Partial<Record<string, number>>;
}

function resolveWeekFromLabel(label: string, yearWeeks: MonthMondayWeek[]): MonthMondayWeek | undefined {
  const fromYear = yearWeeks.find((week) => week.label === label);
  if (fromYear) return fromYear;
  const match = label.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return undefined;
  const year = 2000 + Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const weekNo = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return undefined;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  return getMonthMondayWeeks(yearMonth).find((week) => week.weekNo === weekNo);
}

function resolveWeekLabelFromRow(
  row: ImportRow,
  yearWeeks: MonthMondayWeek[],
  weekIdx: number,
  dateIdx: number,
): string {
  const explicitLabel = weekIdx >= 0 ? String(row.cells[weekIdx] || '').trim() : '';
  if (explicitLabel) return explicitLabel;
  if (dateIdx < 0) return '';
  const parsedDate = parseDate(String(row.cells[dateIdx] || '').trim());
  if (!parsedDate) return '';
  const dateOnly = parsedDate.slice(0, 10);
  const dateYear = Number.parseInt(dateOnly.slice(0, 4), 10);
  if (!Number.isFinite(dateYear)) return '';
  const anchorYear = Number.parseInt(yearWeeks[0]?.yearMonth.slice(0, 4) || '', 10);
  const matchedWeek = findWeekForDate(
    dateOnly,
    dateYear === anchorYear ? yearWeeks : getYearMondayWeeks(dateYear),
  );
  return matchedWeek?.label || '';
}

export function buildSettlementActualSyncPayload(
  rows: ImportRow[],
  yearWeeks: MonthMondayWeek[],
  persistedRows?: ImportRow[] | null,
): SettlementActualSyncWeekPayload[] {
  const weekIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '해당 주차');
  const dateIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '거래일시');
  const cashflowIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === 'cashflow항목');
  const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '통장에 찍힌 입/출금액');
  const expenseAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '사업비 사용액');
  const vatInIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '매입부가세');
  const depositIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '입금액(사업비,공급가액,은행이자)');
  const refundIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '매입부가세 반환');
  const amountIndexes: SettlementFlowAmountIndexes = {
    cashflowIdx,
    bankAmountIdx,
    expenseAmountIdx,
    vatInIdx,
    depositIdx,
    refundIdx,
  };

  const byWeek = new Map<string, Record<string, number>>();
  const weekLabels = new Set<string>();

  const collectWeekLabels = (candidateRows: ImportRow[] | null | undefined) => {
    if (!candidateRows) return;
    for (const row of candidateRows) {
      const label = resolveWeekLabelFromRow(row, yearWeeks, weekIdx, dateIdx);
      if (label) weekLabels.add(label);
    }
  };

  collectWeekLabels(rows);
  collectWeekLabels(persistedRows);

  for (const row of rows) {
    const weekLabel = resolveWeekLabelFromRow(row, yearWeeks, weekIdx, dateIdx);
    const cashflowLabel = cashflowIdx >= 0 ? String(row.cells[cashflowIdx] || '').trim() : '';
    if (!weekLabel || !cashflowLabel) continue;
    const lineId = parseCashflowLineLabel(cashflowLabel);
    if (!lineId) continue;
    const target = byWeek.get(weekLabel) || {};
    const resolvedAmounts = resolveSettlementCashflowActualLineAmounts(row, amountIndexes);
    for (const [resolvedLineId, amount] of Object.entries(resolvedAmounts)) {
      if (!amount) continue;
      target[resolvedLineId] = (target[resolvedLineId] || 0) + amount;
    }
    byWeek.set(weekLabel, target);
  }

  const cleared: Partial<Record<string, number>> = {};
  for (const lineId of CASHFLOW_ALL_LINES) {
    cleared[lineId] = 0;
  }

  const targetWeeks = Array.from(weekLabels)
    .map((label) => resolveWeekFromLabel(label, yearWeeks))
    .filter((week): week is MonthMondayWeek => Boolean(week?.yearMonth));

  return targetWeeks.map((week) => ({
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
    amounts: { ...cleared, ...(byWeek.get(week.label) || {}) },
  }));
}
