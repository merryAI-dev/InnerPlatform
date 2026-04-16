import { describe, expect, it } from 'vitest';
import {
  buildPortalBankStatementsSummary,
  buildPortalDashboardSummary,
  buildPortalPayrollSummary,
  buildPortalWeeklyExpensesSummary,
  mountPortalReadModelRoutes,
} from './portal-read-model.mjs';

function createExpenseSheet(id, name, rows = []) {
  return {
    id,
    name,
    rows,
    order: 0,
  };
}

describe('portal read-model helpers', () => {
  it('builds a dashboard summary from compact portal state', () => {
    const result = buildPortalDashboardSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
        managerName: '보람',
        status: 'IN_PROGRESS',
      },
      todayIso: '2026-04-16',
      payrollRiskCount: 2,
      weeklySubmissionStatuses: [
        {
          id: 'p001-2026-04-w3',
          projectId: 'p001',
          yearMonth: '2026-04',
          weekNo: 3,
          projectionEdited: true,
          projectionUpdated: true,
          expenseEdited: false,
          expenseUpdated: false,
          expenseReviewPendingCount: 1,
        },
      ],
      visibleProjects: 3,
      hrAlertCount: 1,
    });

    expect(result.project.id).toBe('p001');
    expect(result.surface.currentWeekLabel).toBe('3주차');
    expect(result.surface.visibleIssues.map((issue) => issue.label)).toContain('미확인 공지');
    expect(result.summary.payrollRiskCount).toBe(2);
    expect(result.summary.visibleProjects).toBe(3);
  });

  it('builds a payroll summary that exposes the current liquidity queue item', () => {
    const result = buildPortalPayrollSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
      },
      payrollSchedule: {
        id: 'p001',
        projectId: 'p001',
        dayOfMonth: 25,
        timezone: 'Asia/Seoul',
        noticeLeadBusinessDays: 3,
        active: true,
      },
      payrollRuns: [
        {
          id: 'p001-2026-03',
          projectId: 'p001',
          yearMonth: '2026-03',
          plannedPayDate: '2026-03-25',
          noticeDate: '2026-03-20',
          noticeLeadBusinessDays: 3,
          acknowledged: true,
          paidStatus: 'CONFIRMED',
          matchedTxIds: ['tx001'],
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        {
          id: 'p001-2026-04',
          projectId: 'p001',
          yearMonth: '2026-04',
          plannedPayDate: '2026-04-25',
          noticeDate: '2026-04-22',
          noticeLeadBusinessDays: 3,
          acknowledged: false,
          paidStatus: 'MISSING',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      transactions: [
        {
          id: 'tx001',
          projectId: 'p001',
          state: 'APPROVED',
          dateTime: '2026-04-24T09:00:00.000Z',
          amounts: { bankAmount: 1200000, depositAmount: 0, expenseAmount: 1200000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 3400000 },
        },
      ],
      todayIso: '2026-04-26',
    });

    expect(result.schedule.dayOfMonth).toBe(25);
    expect(result.currentRun.plannedPayDate).toBe('2026-04-25');
    expect(result.summary.queueCount).toBe(1);
    expect(result.summary.status).toBe('payment_unconfirmed');
  });

  it('builds weekly expense and bank statement summaries with handoff metadata', () => {
    const weekly = buildPortalWeeklyExpensesSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
      },
      todayIso: '2026-04-16',
      weeklySubmissionStatuses: [
        {
          id: 'p001-2026-04-w3',
          projectId: 'p001',
          yearMonth: '2026-04',
          weekNo: 3,
          projectionEdited: true,
          projectionUpdated: true,
          expenseEdited: true,
          expenseUpdated: false,
          expenseReviewPendingCount: 2,
        },
      ],
      expenseSheets: [
        createExpenseSheet('default', '기본 탭', [{ tempId: 'r1', cells: ['a'] }]),
        createExpenseSheet('sheet-2', '보조 탭', []),
      ],
      activeExpenseSheetId: 'default',
      bankStatementRows: {
        columns: ['통장번호', '거래일시'],
        rows: [{ tempId: 'b1', cells: ['001', '2026-04-16'] }],
      },
      sheetSources: [
        { sourceType: 'bank_statement', sheetName: '통장내역', fileName: 'bank.xls', rowCount: 1, columnCount: 2, uploadedAt: '2026-04-16T09:00:00.000Z' },
      ],
    });

    expect(weekly.expenseSheet.sheetCount).toBe(2);
    expect(weekly.bankStatement.rowCount).toBe(1);
    expect(weekly.handoff.canOpenWeeklyExpenses).toBe(true);
    expect(weekly.summary.expenseReviewPendingCount).toBe(2);

    const bank = buildPortalBankStatementsSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
      },
      activeExpenseSheetId: 'default',
      expenseSheets: [
        createExpenseSheet('default', '기본 탭', [{ tempId: 'r1', cells: ['a'] }]),
      ],
      bankStatementRows: {
        columns: ['통장번호', '거래일시'],
        rows: [{ tempId: 'b1', cells: ['001', '2026-04-16'] }],
      },
    });

    expect(bank.bankStatement.profile).toBe('general');
    expect(bank.handoffContext.ready).toBe(true);
    expect(bank.handoffContext.nextPath).toBe('/portal/weekly-expenses');
  });

  it('registers the four portal read-model endpoints', () => {
    const routes = [];
    const app = {
      get(path, handler) {
        routes.push({ path, handler });
      },
    };

    mountPortalReadModelRoutes(app, {
      db: {},
    });

    expect(routes.map((route) => route.path)).toEqual([
      '/api/v1/portal/dashboard-summary',
      '/api/v1/portal/payroll-summary',
      '/api/v1/portal/weekly-expenses-summary',
      '/api/v1/portal/bank-statements-summary',
    ]);
  });
});
