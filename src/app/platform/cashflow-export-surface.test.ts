import { describe, expect, it } from 'vitest';
import type { CashflowWeekSheet } from '../data/types';
import {
  buildCashflowExportProjectRows,
  resolveCurrentCashflowWeek,
  resolveLatestThursdayCutoffIso,
} from './cashflow-export-surface';

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
    actual: { SALES_IN: 0 },
    projectionTotals: { totalIn: 0, totalOut: 0, net: 0 },
    actualTotals: { totalIn: 0, totalOut: 0, net: 0 },
    projectionUpdated: true,
    pmSubmitted: false,
    adminClosed: false,
    createdAt: input.updatedAt || '2026-04-01T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-04-01T00:00:00.000Z',
  };
}

describe('cashflow-export-surface', () => {
  it('resolves the current week without deriving financial totals', () => {
    expect(resolveCurrentCashflowWeek('2026-04-09')).toMatchObject({
      yearMonth: '2026-04',
      weekNo: 2,
      weekStart: '2026-04-06',
      weekEnd: '2026-04-12',
    });
  });

  it('resolves the latest Thursday midnight cutoff in Seoul time', () => {
    expect(resolveLatestThursdayCutoffIso('2026-07-29')).toBe('2026-07-23T00:00:00+09:00');
    expect(resolveLatestThursdayCutoffIso('2026-07-30')).toBe('2026-07-30T00:00:00+09:00');
  });

  it('builds export rows from update timestamps without deriving financial totals', () => {
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
          weekStart: '2026-04-06',
          weekEnd: '2026-04-12',
          updatedAt: '2026-04-09T01:00:00.000Z',
        }),
        {
          ...createWeek({
            projectId: 'p2',
            yearMonth: '2026-04',
            weekNo: 2,
            weekStart: '2026-04-06',
            weekEnd: '2026-04-12',
            updatedAt: '2026-04-01T01:00:00.000Z',
          }),
          projectionTotals: { totalIn: 1000, totalOut: 200, net: 800 },
          actualTotals: { totalIn: 900, totalOut: 200, net: 700 },
        },
      ],
      todayIso: '2026-04-09',
    });

    expect(rows[0]).toMatchObject({
      id: 'p1',
      updated: true,
      latestUpdatedAt: '2026-04-09T01:00:00.000Z',
    });
    expect(rows[1]).toMatchObject({
      id: 'p2',
      updated: false,
      latestUpdatedAt: '2026-04-01T01:00:00.000Z',
    });
  });
});
