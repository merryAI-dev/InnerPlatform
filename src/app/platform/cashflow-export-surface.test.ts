import { describe, expect, it } from 'vitest';
import type { CashflowWeekSheet, WeeklySubmissionStatus } from '../data/types';
import { buildCashflowExportProjectRows, resolveCurrentCashflowWeek } from './cashflow-export-surface';

function createWeek(input: {
  projectId: string;
  yearMonth: string;
  weekNo: number;
  weekStart: string;
  weekEnd: string;
  updatedAt?: string;
}): CashflowWeekSheet {
  return {
    id: `${input.projectId}-${input.yearMonth}-w${input.weekNo}`,
    projectId: input.projectId,
    yearMonth: input.yearMonth,
    weekNo: input.weekNo,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    projection: {},
    actual: {},
    pmSubmitted: false,
    adminClosed: false,
    createdAt: input.updatedAt || '2026-04-01T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-04-01T00:00:00.000Z',
  };
}

function createStatus(input: {
  projectId: string;
  yearMonth: string;
  weekNo: number;
  projectionUpdated?: boolean;
  projectionUpdatedAt?: string;
}): WeeklySubmissionStatus {
  return {
    id: `${input.projectId}-${input.yearMonth}-w${input.weekNo}`,
    projectId: input.projectId,
    yearMonth: input.yearMonth,
    weekNo: input.weekNo,
    projectionUpdated: input.projectionUpdated,
    projectionUpdatedAt: input.projectionUpdatedAt,
  };
}

describe('cashflow-export-surface', () => {
  it('resolves the current week using Wednesday-based buckets', () => {
    expect(resolveCurrentCashflowWeek('2026-04-09')).toMatchObject({
      yearMonth: '2026-04',
      weekNo: 2,
      weekStart: '2026-04-08',
      weekEnd: '2026-04-14',
    });
  });

  it('builds export rows from current-week projection status and projection update timestamps', () => {
    const rows = buildCashflowExportProjectRows({
      projects: [
        { id: 'p1', name: '프로젝트 1', managerName: '담당 A' },
        { id: 'p2', name: '프로젝트 2', managerName: '담당 B' },
      ],
      weeks: [
        createWeek({
          projectId: 'p1',
          yearMonth: '2026-04',
          weekNo: 2,
          weekStart: '2026-04-08',
          weekEnd: '2026-04-14',
          updatedAt: '2026-04-09T09:00:00.000Z',
        }),
      ],
      weeklySubmissionStatuses: [
        createStatus({
          projectId: 'p1',
          yearMonth: '2026-04',
          weekNo: 2,
          projectionUpdated: true,
          projectionUpdatedAt: '2026-04-09T11:00:00.000Z',
        }),
        createStatus({
          projectId: 'p1',
          yearMonth: '2026-03',
          weekNo: 4,
          projectionUpdated: true,
          projectionUpdatedAt: '2026-03-31T12:00:00.000Z',
        }),
        createStatus({
          projectId: 'p2',
          yearMonth: '2026-04',
          weekNo: 2,
          projectionUpdated: false,
          projectionUpdatedAt: '2026-04-08T10:00:00.000Z',
        }),
      ],
      targetYearMonths: ['2026-03', '2026-04'],
      todayIso: '2026-04-09',
    });

    expect(rows[0]).toMatchObject({
      id: 'p1',
      currentWeekNo: 2,
      currentWeekLabel: '2주차',
      currentWeekUpdated: true,
      latestProjectionUpdatedAt: '2026-04-09T11:00:00.000Z',
    });
    expect(rows[1]).toMatchObject({
      id: 'p2',
      currentWeekNo: 2,
      currentWeekLabel: '2주차',
      currentWeekUpdated: false,
      latestProjectionUpdatedAt: '2026-04-08T10:00:00.000Z',
    });
  });
});
