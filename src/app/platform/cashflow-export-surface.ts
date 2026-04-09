import type { CashflowWeekSheet, WeeklySubmissionStatus } from '../data/types';
import { getMonthMondayWeeks, type MonthMondayWeek } from './cashflow-weeks';

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
  latestProjectionUpdatedAt?: string;
  currentWeekNo?: number;
  currentWeekLabel: string;
  currentWeekUpdated: boolean;
}

function buildStatusKey(projectId: string, yearMonth: string, weekNo: number): string {
  return `${projectId}-${yearMonth}-w${weekNo}`;
}

export function resolveCurrentCashflowWeek(todayIso: string): MonthMondayWeek | undefined {
  const yearMonth = typeof todayIso === 'string' ? todayIso.slice(0, 7) : '';
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return undefined;
  return getMonthMondayWeeks(yearMonth).find((week) => todayIso >= week.weekStart && todayIso <= week.weekEnd);
}

export function buildCashflowExportProjectRows(input: {
  projects: CashflowExportSurfaceProject[];
  weeks: CashflowWeekSheet[];
  weeklySubmissionStatuses: WeeklySubmissionStatus[];
  targetYearMonths: string[];
  todayIso: string;
}): CashflowExportProjectRow[] {
  const targetYearMonths = new Set(input.targetYearMonths);
  const currentWeek = resolveCurrentCashflowWeek(input.todayIso);
  const statusMap = new Map<string, WeeklySubmissionStatus>();

  for (const status of input.weeklySubmissionStatuses) {
    statusMap.set(buildStatusKey(status.projectId, status.yearMonth, status.weekNo), status);
  }

  return input.projects.map((project) => {
    const projectWeeks = input.weeks.filter((week) => week.projectId === project.id && targetYearMonths.has(week.yearMonth));
    const projectStatuses = input.weeklySubmissionStatuses.filter((status) => (
      status.projectId === project.id && targetYearMonths.has(status.yearMonth)
    ));

    const latestProjectionUpdatedAt = projectStatuses.reduce<string | undefined>((latest, status) => {
      if (!status.projectionUpdatedAt) return latest;
      if (!latest || status.projectionUpdatedAt > latest) return status.projectionUpdatedAt;
      return latest;
    }, undefined);

    const currentWeekStatus = currentWeek
      ? statusMap.get(buildStatusKey(project.id, currentWeek.yearMonth, currentWeek.weekNo))
      : undefined;
    const currentWeekSheet = currentWeek
      ? input.weeks.find((week) => (
        week.projectId === project.id
        && week.yearMonth === currentWeek.yearMonth
        && week.weekNo === currentWeek.weekNo
      ))
      : undefined;

    return {
      id: project.id,
      name: project.name,
      managerName: project.managerName,
      updated: projectWeeks.length > 0,
      latestProjectionUpdatedAt,
      currentWeekNo: currentWeek?.weekNo,
      currentWeekLabel: currentWeek ? `${currentWeek.weekNo}주차` : '-',
      currentWeekUpdated: typeof currentWeekStatus?.projectionUpdated === 'boolean'
        ? currentWeekStatus.projectionUpdated
        : Boolean(currentWeekSheet?.updatedAt),
    };
  });
}
