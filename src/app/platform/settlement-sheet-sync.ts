import { parseNumber } from './csv-utils';
import { CASHFLOW_ALL_LINES } from './cashflow-sheet';
import { getMonthMondayWeeks, type MonthMondayWeek } from './cashflow-weeks';
import {
  parseCashflowLineLabel,
  SETTLEMENT_COLUMNS,
  type ImportRow,
} from './settlement-csv';

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

export function buildSettlementActualSyncPayload(
  rows: ImportRow[],
  yearWeeks: MonthMondayWeek[],
  persistedRows?: ImportRow[] | null,
): SettlementActualSyncWeekPayload[] {
  const weekIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '해당 주차');
  const cashflowIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === 'cashflow항목');
  const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '통장에 찍힌 입/출금액');

  const byWeek = new Map<string, Record<string, number>>();
  const weekLabels = new Set<string>();

  const collectWeekLabels = (candidateRows: ImportRow[] | null | undefined) => {
    if (!candidateRows || weekIdx < 0) return;
    for (const row of candidateRows) {
      const label = String(row.cells[weekIdx] || '').trim();
      if (label) weekLabels.add(label);
    }
  };

  collectWeekLabels(rows);
  collectWeekLabels(persistedRows);

  for (const row of rows) {
    const weekLabel = weekIdx >= 0 ? String(row.cells[weekIdx] || '').trim() : '';
    const cashflowLabel = cashflowIdx >= 0 ? String(row.cells[cashflowIdx] || '').trim() : '';
    if (!weekLabel || !cashflowLabel) continue;
    const lineId = parseCashflowLineLabel(cashflowLabel);
    if (!lineId || lineId === 'INPUT_VAT_OUT') continue;
    const amount = bankAmountIdx >= 0 ? (parseNumber(row.cells[bankAmountIdx]) ?? 0) : 0;
    if (amount === 0) continue;
    const target = byWeek.get(weekLabel) || {};
    target[lineId] = (target[lineId] || 0) + amount;
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
