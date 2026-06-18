import { describe, expect, it } from 'vitest';
import { buildCashflowLaborRisk } from './cashflow-labor-risk.mjs';

function projectWithWeeks(activeWeeks) {
  return {
    id: 'project-a',
    cashflowSheetLab: { activeWeeks },
  };
}

function activeWeek(yearMonth, weekNo, weekStart, weekEnd) {
  return { yearMonth, weekNo, weekStart, weekEnd };
}

function weekDoc({ yearMonth, weekNo, weekStart, weekEnd, projection = {}, actual = {} }) {
  return {
    id: `project-a-${yearMonth}-w${weekNo}`,
    projectId: 'project-a',
    yearMonth,
    weekNo,
    weekStart,
    weekEnd,
    projection,
    actual,
  };
}

describe('cashflow labor risk', () => {
  it('flags future months where MYSC labor is not included in Projection', () => {
    const activeWeeks = [
      activeWeek('2026-05', 4, '2026-05-20', '2026-05-26'),
      activeWeek('2026-06', 3, '2026-06-17', '2026-06-23'),
      activeWeek('2026-07', 1, '2026-07-01', '2026-07-07'),
    ];
    const result = buildCashflowLaborRisk('project-a', projectWithWeeks(activeWeeks), [
      weekDoc({
        yearMonth: '2026-05',
        weekNo: 4,
        weekStart: '2026-05-20',
        weekEnd: '2026-05-26',
        actual: { MYSC_LABOR_OUT: 12_016_033, SALES_IN: 50_000_000 },
      }),
      weekDoc({
        yearMonth: '2026-06',
        weekNo: 3,
        weekStart: '2026-06-17',
        weekEnd: '2026-06-23',
        actual: { SALES_IN: 10_000_000 },
        projection: { SALES_IN: 20_000_000 },
      }),
    ], { todayIso: '2026-06-17' });

    expect(result.labor.lastMonth).toMatchObject({
      yearMonth: '2026-05',
      actualAmount: 12_016_033,
    });
    expect(result.shortage.status).toBe('warning');
    expect(result.shortage.reliable).toBe(false);
    expect(result.labor.nextMonthProjection).toMatchObject({
      yearMonth: '2026-07',
      isWritten: false,
      projectionAmount: 0,
    });
    expect(result.labor.missingProjectionMonths.map((month) => month.yearMonth)).toEqual(['2026-06', '2026-07']);
  });

  it('predicts the first future week where Projection makes the balance negative', () => {
    const activeWeeks = [
      activeWeek('2026-05', 4, '2026-05-20', '2026-05-26'),
      activeWeek('2026-06', 3, '2026-06-17', '2026-06-23'),
      activeWeek('2026-06', 4, '2026-06-24', '2026-06-30'),
    ];
    const result = buildCashflowLaborRisk('project-a', projectWithWeeks(activeWeeks), [
      weekDoc({
        yearMonth: '2026-05',
        weekNo: 4,
        weekStart: '2026-05-20',
        weekEnd: '2026-05-26',
        actual: { MYSC_LABOR_OUT: 12_016_033 },
      }),
      weekDoc({
        yearMonth: '2026-06',
        weekNo: 3,
        weekStart: '2026-06-17',
        weekEnd: '2026-06-23',
        actual: { SALES_IN: 100_000_000 },
      }),
      weekDoc({
        yearMonth: '2026-06',
        weekNo: 4,
        weekStart: '2026-06-24',
        weekEnd: '2026-06-30',
        projection: { MYSC_LABOR_OUT: 120_000_000 },
      }),
    ], { todayIso: '2026-06-17' });

    expect(result.current.balance).toBe(87_983_967);
    expect(result.shortage).toMatchObject({
      status: 'danger',
      reliable: true,
      projectedBalance: -32_016_033,
      shortageAmount: 32_016_033,
    });
    expect(result.shortage.week).toMatchObject({ yearMonth: '2026-06', weekNo: 4, label: '26-6-4' });
  });

  it('keeps the next month labor Projection authored status as static data', () => {
    const activeWeeks = [
      activeWeek('2026-05', 4, '2026-05-20', '2026-05-26'),
      activeWeek('2026-06', 3, '2026-06-17', '2026-06-23'),
      activeWeek('2026-07', 1, '2026-07-01', '2026-07-07'),
    ];
    const result = buildCashflowLaborRisk('project-a', projectWithWeeks(activeWeeks), [
      weekDoc({
        yearMonth: '2026-05',
        weekNo: 4,
        weekStart: '2026-05-20',
        weekEnd: '2026-05-26',
        actual: { MYSC_LABOR_OUT: 12_016_033 },
      }),
      weekDoc({
        yearMonth: '2026-06',
        weekNo: 3,
        weekStart: '2026-06-17',
        weekEnd: '2026-06-23',
        actual: { SALES_IN: 50_000_000, MYSC_LABOR_OUT: 12_016_033 },
        projection: { MYSC_LABOR_OUT: 12_016_033 },
      }),
      weekDoc({
        yearMonth: '2026-07',
        weekNo: 1,
        weekStart: '2026-07-01',
        weekEnd: '2026-07-07',
        projection: { MYSC_LABOR_OUT: 12_016_033 },
      }),
    ], { todayIso: '2026-06-17' });

    expect(result.snapshotKind).toBe('cashflow_labor_risk');
    expect(result.labor.nextMonthProjection).toMatchObject({
      yearMonth: '2026-07',
      label: '2026년 7월',
      isWritten: true,
      projectionAmount: 12_016_033,
    });
    expect(result.shortage.message).toContain('지난달 Actual 인건비');
    expect(result.shortage.message).toContain('인건비 부족은 없습니다');
  });
});
