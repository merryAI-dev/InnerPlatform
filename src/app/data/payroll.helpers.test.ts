import { describe, expect, it } from 'vitest';
import type { MonthlyClose, PayrollRun, PayrollSchedule } from './types';
import {
  mergeMonthlyCloseState,
  mergePayrollRunState,
  mergePayrollScheduleState,
  sortMonthlyClosesByYearMonth,
  sortPayrollRunsByPlannedPayDate,
} from './payroll.helpers';

describe('payroll helpers', () => {
  it('sorts payroll runs by planned pay date descending for PM listeners', () => {
    const rows = [
      {
        id: 'r1',
        projectId: 'p1',
        yearMonth: '2026-03',
        plannedPayDate: '2026-03-25',
        noticeDate: '2026-03-20',
        noticeLeadBusinessDays: 3,
        acknowledged: false,
        paidStatus: 'UNKNOWN',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
      {
        id: 'r2',
        projectId: 'p1',
        yearMonth: '2026-05',
        plannedPayDate: '2026-05-25',
        noticeDate: '2026-05-20',
        noticeLeadBusinessDays: 3,
        acknowledged: false,
        paidStatus: 'UNKNOWN',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
      {
        id: 'r3',
        projectId: 'p1',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-25',
        noticeDate: '2026-04-20',
        noticeLeadBusinessDays: 3,
        acknowledged: false,
        paidStatus: 'UNKNOWN',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
    ] satisfies PayrollRun[];

    expect(sortPayrollRunsByPlannedPayDate(rows).map((row) => row.id)).toEqual(['r2', 'r3', 'r1']);
  });

  it('sorts monthly closes by yearMonth descending for PM listeners', () => {
    const rows = [
      {
        id: 'm1',
        projectId: 'p1',
        yearMonth: '2026-02',
        status: 'DONE',
        acknowledged: false,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
      },
      {
        id: 'm2',
        projectId: 'p1',
        yearMonth: '2026-04',
        status: 'DONE',
        acknowledged: false,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'm3',
        projectId: 'p1',
        yearMonth: '2026-03',
        status: 'DONE',
        acknowledged: false,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
    ] satisfies MonthlyClose[];

    expect(sortMonthlyClosesByYearMonth(rows).map((row) => row.id)).toEqual(['m2', 'm3', 'm1']);
  });

  it('replaces a payroll run in local state and keeps planned pay date ordering', () => {
    const rows = [
      {
        id: 'p1-2026-04',
        projectId: 'p1',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-25',
        noticeDate: '2026-04-22',
        noticeLeadBusinessDays: 3,
        acknowledged: false,
        paidStatus: 'UNKNOWN',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'p1-2026-05',
        projectId: 'p1',
        yearMonth: '2026-05',
        plannedPayDate: '2026-05-25',
        noticeDate: '2026-05-20',
        noticeLeadBusinessDays: 3,
        acknowledged: false,
        paidStatus: 'UNKNOWN',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      },
    ] satisfies PayrollRun[];

    const next = mergePayrollRunState(rows, {
      ...rows[0],
      acknowledged: true,
      paidStatus: 'AUTO_MATCHED',
      updatedAt: '2026-04-16T00:00:00.000Z',
    });

    expect(next.map((row) => [row.id, row.acknowledged, row.paidStatus])).toEqual([
      ['p1-2026-05', false, 'UNKNOWN'],
      ['p1-2026-04', true, 'AUTO_MATCHED'],
    ]);
  });

  it('replaces a payroll schedule in local state by project id', () => {
    const rows = [
      {
        id: 'p1',
        projectId: 'p1',
        dayOfMonth: 25,
        timezone: 'Asia/Seoul',
        noticeLeadBusinessDays: 3,
        active: true,
        updatedAt: '2026-04-01T00:00:00.000Z',
        updatedBy: 'user-1',
      },
    ] satisfies PayrollSchedule[];

    const next = mergePayrollScheduleState(rows, {
      ...rows[0],
      dayOfMonth: 16,
      updatedAt: '2026-04-16T00:00:00.000Z',
      updatedBy: 'user-2',
    });

    expect(next).toEqual([
      expect.objectContaining({
        id: 'p1',
        dayOfMonth: 16,
        updatedBy: 'user-2',
      }),
    ]);
  });

  it('replaces a monthly close in local state by id', () => {
    const rows = [
      {
        id: 'p1-2026-03',
        projectId: 'p1',
        yearMonth: '2026-03',
        status: 'OPEN',
        acknowledged: false,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
    ] satisfies MonthlyClose[];

    const next = mergeMonthlyCloseState(rows, {
      ...rows[0],
      status: 'DONE',
      acknowledged: true,
      updatedAt: '2026-04-16T00:00:00.000Z',
    });

    expect(next).toEqual([
      expect.objectContaining({
        id: 'p1-2026-03',
        status: 'DONE',
        acknowledged: true,
      }),
    ]);
  });
});
