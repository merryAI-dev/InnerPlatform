import { describe, expect, it } from 'vitest';
import type { CashflowWeekSheet } from './types';
import { resolveWeekDocId } from './cashflow-weeks.persistence';
import { getMonthMondayWeeks } from '../platform/cashflow-weeks';
import { applyWeekAmountsToLocalWeeks } from './cashflow-weeks.local-state';

describe('applyWeekAmountsToLocalWeeks', () => {
  it('merges saved projection amounts into an existing week for pm reads', () => {
    const [week] = getMonthMondayWeeks('2026-04');
    const existing: CashflowWeekSheet = {
      id: resolveWeekDocId('p002', '2026-04', week.weekNo),
      tenantId: 'mysc',
      projectId: 'p002',
      yearMonth: '2026-04',
      weekNo: week.weekNo,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      projection: { SALES_IN: 1000000 },
      actual: {},
      pmSubmitted: false,
      adminClosed: false,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
      updatedByUid: 'u-old',
      updatedByName: 'Old PM',
    };

    const result = applyWeekAmountsToLocalWeeks({
      weeks: [existing],
      orgId: 'mysc',
      actorUid: 'u-pm',
      actorName: 'PM 보람',
      projectId: 'p002',
      yearMonth: '2026-04',
      weekNo: week.weekNo,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      mode: 'projection',
      amounts: { MYSC_LABOR_OUT: 3100000 },
      now: '2026-04-16T10:00:00.000Z',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      projection: {
        SALES_IN: 1000000,
        MYSC_LABOR_OUT: 3100000,
      },
      updatedAt: '2026-04-16T10:00:00.000Z',
      updatedByUid: 'u-pm',
      updatedByName: 'PM 보람',
    });
  });

  it('marks near-week large projection edits for admin attention', () => {
    const existing: CashflowWeekSheet = {
      id: resolveWeekDocId('p002', '2026-06', 1),
      tenantId: 'mysc',
      projectId: 'p002',
      yearMonth: '2026-06',
      weekNo: 1,
      weekStart: '2026-06-01',
      weekEnd: '2026-06-07',
      projection: { DIRECT_COST_OUT: 1000000 },
      actual: {},
      pmSubmitted: false,
      adminClosed: false,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    const result = applyWeekAmountsToLocalWeeks({
      weeks: [existing],
      orgId: 'mysc',
      actorUid: 'u-pm',
      actorName: 'PM 보람',
      projectId: 'p002',
      yearMonth: '2026-06',
      weekNo: 1,
      weekStart: '2026-06-01',
      weekEnd: '2026-06-07',
      mode: 'projection',
      amounts: { DIRECT_COST_OUT: 101000000 },
      now: '2026-06-01T10:00:00.000Z',
    });

    expect(result[0].projectionChangeAlert).toMatchObject({
      triggered: true,
      totalAbsDelta: 100000000,
      largestLineId: 'DIRECT_COST_OUT',
      daysBeforeWeekStart: 0,
    });
  });

  it('creates a missing actual week immediately after save', () => {
    const [, , week] = getMonthMondayWeeks('2026-04');

    const result = applyWeekAmountsToLocalWeeks({
      weeks: [],
      orgId: 'mysc',
      actorUid: 'u-pm',
      actorName: 'PM 보람',
      projectId: 'p002',
      yearMonth: '2026-04',
      weekNo: week.weekNo,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      mode: 'actual',
      amounts: { MYSC_LABOR_OUT: 3100000 },
      now: '2026-04-16T10:00:00.000Z',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: resolveWeekDocId('p002', '2026-04', week.weekNo),
      projectId: 'p002',
      yearMonth: '2026-04',
      weekNo: week.weekNo,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      projection: {},
      actual: { MYSC_LABOR_OUT: 3100000 },
      pmSubmitted: false,
      adminClosed: false,
      createdAt: '2026-04-16T10:00:00.000Z',
      updatedAt: '2026-04-16T10:00:00.000Z',
      updatedByUid: 'u-pm',
      updatedByName: 'PM 보람',
    });
  });
});
