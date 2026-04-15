import { describe, expect, it } from 'vitest';
import type { MonthlyClose, PayrollRun } from './types';
import { sortMonthlyClosesByYearMonth, sortPayrollRunsByPlannedPayDate } from './payroll.helpers';

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
});
