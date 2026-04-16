import type { CashflowWeekSheet, PayrollRun } from '../data/types';
import { findWeekForDate, getMonthMondayWeeks, type MonthMondayWeek } from './cashflow-weeks';

export type PayrollCashflowAlertFlag =
  | 'pm_amount_missing'
  | 'cashflow_projection_missing'
  | 'amount_mismatch';

export interface PayrollCashflowReferenceWeek {
  yearMonth: string;
  weekNo: number;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
}

export interface PayrollCashflowAlignment {
  pmExpectedPayrollAmount: number | null;
  cashflowProjectedPayrollAmount: number | null;
  referenceWeek: PayrollCashflowReferenceWeek | null;
  flags: PayrollCashflowAlertFlag[];
}

function normalizeAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function toReferenceWeek(week: MonthMondayWeek | undefined): PayrollCashflowReferenceWeek | null {
  if (!week) return null;
  return {
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
    weekLabel: week.label,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
  };
}

export function resolvePayrollCashflowAlignment(input: {
  run: PayrollRun;
  cashflowWeeks?: CashflowWeekSheet[];
}): PayrollCashflowAlignment {
  const monthWeeks = getMonthMondayWeeks(input.run.plannedPayDate.slice(0, 7));
  const referenceWeek = findWeekForDate(input.run.plannedPayDate, monthWeeks);
  const pmExpectedPayrollAmount = normalizeAmount(input.run.pmExpectedPayrollAmount);
  const cashflowWeeks = input.cashflowWeeks || [];
  const weekSheet = referenceWeek
    ? cashflowWeeks.find((week) => (
      week.projectId === input.run.projectId
      && week.yearMonth === referenceWeek.yearMonth
      && week.weekNo === referenceWeek.weekNo
    ))
    : undefined;
  const cashflowProjectedPayrollAmount = normalizeAmount(weekSheet?.projection?.MYSC_LABOR_OUT);
  const flags: PayrollCashflowAlertFlag[] = [];

  if (pmExpectedPayrollAmount === null) flags.push('pm_amount_missing');
  if (cashflowProjectedPayrollAmount === null) flags.push('cashflow_projection_missing');
  if (
    pmExpectedPayrollAmount !== null
    && cashflowProjectedPayrollAmount !== null
    && pmExpectedPayrollAmount !== cashflowProjectedPayrollAmount
  ) {
    flags.push('amount_mismatch');
  }

  return {
    pmExpectedPayrollAmount,
    cashflowProjectedPayrollAmount,
    referenceWeek: toReferenceWeek(referenceWeek),
    flags,
  };
}
