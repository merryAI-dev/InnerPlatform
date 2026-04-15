import type { MonthlyClose, PayrollRun } from './types';

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
