import { describe, expect, it } from 'vitest';
import type { CashflowWeekSheet } from '../data/types';
import { buildCashflowExportWorkbookSpec, buildCashflowWeekSlots, expandCashflowYearMonthRange, normalizeCashflowYearMonths } from './cashflow-export';

function createWeekSheet(input: {
  projectId: string;
  yearMonth: string;
  weekNo: number;
  weekStart: string;
  weekEnd: string;
  projection?: Record<string, number>;
  actual?: Record<string, number>;
}): CashflowWeekSheet {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: `${input.projectId}-${input.yearMonth}-w${input.weekNo}`,
    projectId: input.projectId,
    yearMonth: input.yearMonth,
    weekNo: input.weekNo,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    projection: input.projection || {},
    actual: input.actual || {},
    pmSubmitted: true,
    adminClosed: false,
    createdAt: now,
    updatedAt: now,
  };
}

function findRow(rows: Array<Array<string | number>>, label: string): Array<string | number> | undefined {
  return rows.find((row) => row[0] === label);
}

function findMonthWithMissingFifthWeek(year: number): string {
  for (let month = 1; month <= 12; month += 1) {
    const ym = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    const slots = buildCashflowWeekSlots(ym);
    if (slots.length === 5 && slots.filter((slot) => slot.present).length === 4) {
      return ym;
    }
  }
  throw new Error('Expected at least one month with only four fixed weeks');
}

describe('cashflow-export', () => {
  it('normalizes year-month input and expands contiguous ranges', () => {
    expect(normalizeCashflowYearMonths(['2026-03', '2026-01', 'bad', '2026-01'])).toEqual(['2026-01', '2026-03']);
    expect(expandCashflowYearMonthRange('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('keeps a fixed five-slot month shape even when the fifth week does not exist', () => {
    const yearMonth = findMonthWithMissingFifthWeek(2026);
    const slots = buildCashflowWeekSlots(yearMonth);

    expect(slots).toHaveLength(5);
    expect(slots[4]).toMatchObject({
      weekNo: 5,
      present: false,
      weekStart: '',
      weekEnd: '',
    });
  });

  it('builds single-project workbook sheets with projection and actual separated', () => {
    const yearMonth = findMonthWithMissingFifthWeek(2026);
    const slots = buildCashflowWeekSlots(yearMonth);
    const week1 = slots[0];
    const week2 = slots[1];

    const project = {
      projectId: 'proj-a',
      projectName: '프로젝트 A',
      projectShortName: 'A',
      weeks: [
        createWeekSheet({
          projectId: 'proj-a',
          yearMonth,
          weekNo: 1,
          weekStart: week1.weekStart,
          weekEnd: week1.weekEnd,
          projection: { SALES_IN: 100, DIRECT_COST_OUT: 10 },
          actual: { SALES_IN: 80, DIRECT_COST_OUT: 20 },
        }),
        createWeekSheet({
          projectId: 'proj-a',
          yearMonth,
          weekNo: 2,
          weekStart: week2.weekStart,
          weekEnd: week2.weekEnd,
          projection: { SALES_IN: 200 },
          actual: { SALES_IN: 150 },
        }),
      ],
      transactions: [],
    };

    const workbook = buildCashflowExportWorkbookSpec({
      variant: 'single-project',
      projects: [project],
      yearMonths: [yearMonth],
    });

    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Projection', 'Actual']);
    expect(workbook.sheets[0].rows[0]).toEqual(['사업', '프로젝트 A', '사업 ID', 'proj-a', '거래 수', 0]);
    expect(findRow(workbook.sheets[0].rows, '매출액(입금)')).toEqual(['매출액(입금)', 100, 200, 0, 0, 0, 300]);
    expect(findRow(workbook.sheets[1].rows, '매출액(입금)')).toEqual(['매출액(입금)', 80, 150, 0, 0, 0, 230]);
    expect(findRow(workbook.sheets[0].rows, '직접사업비')).toEqual(['직접사업비', 10, 0, 0, 0, 0, 10]);
    expect(findRow(workbook.sheets[1].rows, '직접사업비')).toEqual(['직접사업비', 20, 0, 0, 0, 0, 20]);
    expect(findRow(workbook.sheets[0].rows, '매출액(입금)')?.[5]).toBe(0);
  });

  it('builds combined and multi-sheet workbooks for multiple projects', () => {
    const yearMonth = findMonthWithMissingFifthWeek(2026);
    const slots = buildCashflowWeekSlots(yearMonth);
    const week1 = slots[0];

    const projectAlpha = {
      projectId: 'proj-a',
      projectName: '알파 프로젝트',
      projectShortName: 'Alpha',
      weeks: [
        createWeekSheet({
          projectId: 'proj-a',
          yearMonth,
          weekNo: 1,
          weekStart: week1.weekStart,
          weekEnd: week1.weekEnd,
          projection: { SALES_IN: 120 },
          actual: { SALES_IN: 90 },
        }),
      ],
      transactions: [],
    };

    const projectBravo = {
      projectId: 'proj-b',
      projectName: '브라보 프로젝트',
      projectShortName: 'Alpha',
      weeks: [
        createWeekSheet({
          projectId: 'proj-b',
          yearMonth,
          weekNo: 1,
          weekStart: week1.weekStart,
          weekEnd: week1.weekEnd,
          projection: { SALES_IN: 220 },
          actual: { SALES_IN: 210 },
        }),
      ],
      transactions: [],
    };

    const combined = buildCashflowExportWorkbookSpec({
      variant: 'combined',
      projects: [projectAlpha, projectBravo],
      yearMonths: [yearMonth],
    });
    expect(combined.sheets).toHaveLength(1);
    expect(combined.sheets[0].name).toBe('전체 사업');
    expect(combined.sheets[0].rows.some((row) => row.includes('알파 프로젝트'))).toBe(true);
    expect(combined.sheets[0].rows.some((row) => row.includes('브라보 프로젝트'))).toBe(true);

    const multi = buildCashflowExportWorkbookSpec({
      variant: 'multi-sheet',
      projects: [projectAlpha, projectBravo],
      yearMonths: [yearMonth],
    });

    expect(multi.sheets).toHaveLength(2);
    expect(multi.sheets.map((sheet) => sheet.name)).toEqual(['Alpha', 'Alpha (2)']);
    expect(findRow(multi.sheets[0].rows, '매출액(입금)')).toEqual(['매출액(입금)', 120, 0, 0, 0, 0, 120]);
    expect(findRow(multi.sheets[1].rows, '매출액(입금)')).toEqual(['매출액(입금)', 220, 0, 0, 0, 0, 220]);
  });
});

