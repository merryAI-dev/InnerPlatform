import { describe, expect, it } from 'vitest';
import type { CashflowWeekSheet, PayrollRun } from '../data/types';
import { resolvePayrollCashflowAlignment } from './payroll-cashflow-alignment';

function createRun(input: Partial<PayrollRun> & Pick<PayrollRun, 'id' | 'projectId' | 'yearMonth' | 'plannedPayDate'>): PayrollRun {
  return {
    ...input,
    id: input.id,
    tenantId: 'org-1',
    projectId: input.projectId,
    yearMonth: input.yearMonth,
    plannedPayDate: input.plannedPayDate,
    noticeDate: '2026-04-22',
    noticeLeadBusinessDays: 3,
    acknowledged: false,
    paidStatus: 'UNKNOWN',
    matchedTxIds: [],
    reviewCandidates: [],
    pmReviewStatus: 'PENDING',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createWeek(input: Partial<CashflowWeekSheet> & Pick<CashflowWeekSheet, 'id' | 'projectId' | 'yearMonth' | 'weekNo' | 'weekStart' | 'weekEnd'>): CashflowWeekSheet {
  const {
    id,
    projectId,
    yearMonth,
    weekNo,
    weekStart,
    weekEnd,
    ...rest
  } = input;
  return {
    id,
    tenantId: 'org-1',
    projectId,
    yearMonth,
    weekNo,
    weekStart,
    weekEnd,
    projection: {},
    actual: {},
    pmSubmitted: false,
    adminClosed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  };
}

describe('payroll-cashflow-alignment', () => {
  it('reads the planned pay-date week projection and flags amount mismatch', () => {
    const run = createRun({
      id: 'run-1',
      projectId: 'p-1',
      yearMonth: '2026-04',
      plannedPayDate: '2026-04-16',
      pmExpectedPayrollAmount: 3500000,
    });

    const alignment = resolvePayrollCashflowAlignment({
      run,
      cashflowWeeks: [
        createWeek({
          id: 'p-1-2026-04-w3',
          projectId: 'p-1',
          yearMonth: '2026-04',
          weekNo: 3,
          weekStart: '2026-04-15',
          weekEnd: '2026-04-21',
          projection: {
            MYSC_LABOR_OUT: 3100000,
          },
        }),
      ],
    });

    expect(alignment.referenceWeek).toMatchObject({
      yearMonth: '2026-04',
      weekNo: 3,
      weekLabel: '26-4-3',
      weekStart: '2026-04-15',
      weekEnd: '2026-04-21',
    });
    expect(alignment.cashflowProjectedPayrollAmount).toBe(3100000);
    expect(alignment.pmExpectedPayrollAmount).toBe(3500000);
    expect(alignment.flags).toContain('amount_mismatch');
  });

  it('distinguishes missing PM amount from missing cashflow projection amount', () => {
    const run = createRun({
      id: 'run-2',
      projectId: 'p-2',
      yearMonth: '2026-04',
      plannedPayDate: '2026-04-16',
    });

    const alignment = resolvePayrollCashflowAlignment({
      run,
      cashflowWeeks: [],
    });

    expect(alignment.flags).toContain('pm_amount_missing');
    expect(alignment.flags).toContain('cashflow_projection_missing');
    expect(alignment.flags).not.toContain('amount_mismatch');
  });
});
