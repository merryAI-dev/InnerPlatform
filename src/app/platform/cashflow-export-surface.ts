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
  currentWeekNo?: number;
  currentWeekLabel: string;
  projectionActualMatches?: boolean;
  projectionActualInDifference?: number;
  projectionActualOutDifference?: number;
  projectionActualDifference?: number;
  comparisonMissing?: 'projection' | 'actual';
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
  targetYearMonths: string[];
  todayIso: string;
}): CashflowExportProjectRow[] {
  const currentWeek = resolveCurrentCashflowWeek(input.todayIso);
  const cutoffAt = resolveLatestThursdayCutoffIso(input.todayIso);
  const cutoffTimestamp = Date.parse(cutoffAt);

  return input.projects.map((project) => {
    const projectWeeks = input.weeks.filter((week) => week.projectId === project.id);
    const latestUpdatedAt = projectWeeks.reduce<string | undefined>((latest, week) => {
      if (!week.updatedAt) return latest;
      if (!latest || Date.parse(week.updatedAt) > Date.parse(latest)) return week.updatedAt;
      return latest;
    }, undefined);

    const currentWeekSheet = currentWeek
      ? input.weeks.find((week) => (
        week.projectId === project.id
        && week.yearMonth === currentWeek.yearMonth
        && week.weekNo === currentWeek.weekNo
      ))
      : undefined;
    const projectionTotals = currentWeekSheet?.projectionTotals;
    const actualTotals = currentWeekSheet?.actualTotals;
    const projectionNet = projectionTotals?.net || 0;
    const actualNet = actualTotals?.net || 0;
    const projectionActualInDifference = (projectionTotals?.totalIn || 0) - (actualTotals?.totalIn || 0);
    const projectionActualOutDifference = (projectionTotals?.totalOut || 0) - (actualTotals?.totalOut || 0);
    const projectionActualDifference = projectionNet - actualNet;
    const projectionReady = Boolean(currentWeekSheet?.projectionUpdated && projectionTotals);
    const actualReady = Boolean(actualTotals && currentWeekSheet?.actual && Object.keys(currentWeekSheet.actual).length > 0);
    const hasCurrentWeekData = projectionReady && actualReady;
    const projectionActualMatches = hasCurrentWeekData
      && projectionTotals?.totalIn === actualTotals?.totalIn
      && projectionTotals?.totalOut === actualTotals?.totalOut
      && projectionTotals?.net === actualTotals?.net;

    return {
      id: project.id,
      name: project.name,
      managerName: project.managerName,
      updated: Boolean(latestUpdatedAt) && Number.isFinite(cutoffTimestamp) && Date.parse(latestUpdatedAt) >= cutoffTimestamp,
      latestUpdatedAt,
      currentWeekNo: currentWeek?.weekNo,
      currentWeekLabel: currentWeek ? `${currentWeek.weekNo}주차` : '-',
      projectionActualMatches: hasCurrentWeekData ? projectionActualMatches : undefined,
      projectionActualInDifference: hasCurrentWeekData ? projectionActualInDifference : undefined,
      projectionActualOutDifference: hasCurrentWeekData ? projectionActualOutDifference : undefined,
      projectionActualDifference: hasCurrentWeekData ? projectionActualDifference : undefined,
      comparisonMissing: !projectionReady ? 'projection' : !actualReady ? 'actual' : undefined,
    };
  });
}
