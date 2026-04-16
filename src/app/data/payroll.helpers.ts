import type { MonthlyClose, PayrollRun, PayrollSchedule } from './types';

export function sortPayrollRunsByPlannedPayDate(rows: PayrollRun[]): PayrollRun[] {
  return [...rows].sort((a, b) => {
    const payDateCompare = String(b.plannedPayDate || '').localeCompare(String(a.plannedPayDate || ''));
    if (payDateCompare !== 0) return payDateCompare;
    const yearMonthCompare = String(b.yearMonth || '').localeCompare(String(a.yearMonth || ''));
    if (yearMonthCompare !== 0) return yearMonthCompare;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

export function sortMonthlyClosesByYearMonth(rows: MonthlyClose[]): MonthlyClose[] {
  return [...rows].sort((a, b) => {
    const yearMonthCompare = String(b.yearMonth || '').localeCompare(String(a.yearMonth || ''));
    if (yearMonthCompare !== 0) return yearMonthCompare;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

export function mergePayrollRunState(rows: PayrollRun[], next: PayrollRun): PayrollRun[] {
  const filtered = rows.filter((row) => row.id !== next.id);
  return sortPayrollRunsByPlannedPayDate([...filtered, next]);
}

export function mergePayrollScheduleState(rows: PayrollSchedule[], next: PayrollSchedule): PayrollSchedule[] {
  const filtered = rows.filter((row) => row.id !== next.id);
  return [...filtered, next].sort((a, b) => {
    const updatedCompare = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    if (updatedCompare !== 0) return updatedCompare;
    return String(a.projectId || '').localeCompare(String(b.projectId || ''));
  });
}

export function mergeMonthlyCloseState(rows: MonthlyClose[], next: MonthlyClose): MonthlyClose[] {
  const filtered = rows.filter((row) => row.id !== next.id);
  return sortMonthlyClosesByYearMonth([...filtered, next]);
}
