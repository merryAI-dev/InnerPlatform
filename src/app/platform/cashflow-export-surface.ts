import type { CashflowWeekSheet } from '../data/types';
import { findWeekForDate, getMonthMondayWeeks, type MonthMondayWeek } from './cashflow-weeks';

export interface CashflowExportSurfaceProject {
  id: string;
  name: string;
  managerName?: string;
}

export interface CashflowExportProjectRow {
  id: string;
  name: string;
  managerName?: string;
  updated: boolean;
  latestUpdatedAt?: string;
}

export function resolveCurrentCashflowWeek(todayIso: string): MonthMondayWeek | undefined {
  const yearMonth = typeof todayIso === 'string' ? todayIso.slice(0, 7) : '';
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return undefined;
  return findWeekForDate(todayIso, getMonthMondayWeeks(yearMonth));
}

export function resolveLatestThursdayCutoffIso(todayIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) return '';
  const date = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const daysSinceThursday = (date.getUTCDay() - 4 + 7) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceThursday);
  return `${date.toISOString().slice(0, 10)}T00:00:00+09:00`;
}

export function buildCashflowExportProjectRows(input: {
  projects: CashflowExportSurfaceProject[];
  weeks: CashflowWeekSheet[];
  todayIso: string;
}): CashflowExportProjectRow[] {
  const cutoffAt = resolveLatestThursdayCutoffIso(input.todayIso);
  const cutoffTimestamp = Date.parse(cutoffAt);

  return input.projects.map((project) => {
    const projectWeeks = input.weeks.filter((week) => week.projectId === project.id);
    const latestUpdatedAt = projectWeeks.reduce<string | undefined>((latest, week) => {
      if (!week.updatedAt) return latest;
      if (!latest || Date.parse(week.updatedAt) > Date.parse(latest)) return week.updatedAt;
      return latest;
    }, undefined);

    return {
      id: project.id,
      name: project.name,
      managerName: project.managerName,
      updated: Boolean(latestUpdatedAt) && Number.isFinite(cutoffTimestamp) && Date.parse(latestUpdatedAt) >= cutoffTimestamp,
      latestUpdatedAt,
    };
  });
}
