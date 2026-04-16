import { describe, expect, it } from 'vitest';
import { resolveDevHarnessPortalApiResponse } from '../../../vite.config';
import {
  buildDevHarnessPortalBankStatementsSummary,
  buildDevHarnessPortalBankStatementHandoffResult,
  buildDevHarnessPortalCloseCashflowWeekResult,
  buildDevHarnessPortalDashboardSummary,
  buildDevHarnessPortalEntryContext,
  buildDevHarnessPortalOnboardingContext,
  buildDevHarnessPortalPayrollSummary,
  buildDevHarnessPortalRegistrationResult,
  buildDevHarnessPortalSaveWeeklyExpenseResult,
  buildDevHarnessPortalSubmitWeeklySubmissionResult,
  buildDevHarnessPortalSessionProjectResult,
  buildDevHarnessPortalWeeklyExpensesSummary,
} from './dev-harness-portal-api';

describe('dev harness portal api helpers', () => {
  it('builds a registered PM entry context with a visible start project', () => {
    const context = buildDevHarnessPortalEntryContext({ actorId: 'u002', actorRole: 'pm' });

    expect(context.registrationState).toBe('registered');
    expect(context.activeProjectId).toBeTruthy();
    expect(context.priorityProjectIds).toContain(context.activeProjectId);
    expect(context.projects.some((project) => project.id === context.activeProjectId)).toBe(true);
  });

  it('builds an admin entry context with multiple visible projects', () => {
    const context = buildDevHarnessPortalEntryContext({ actorId: 'u001', actorRole: 'admin' });

    expect(context.registrationState).toBe('registered');
    expect(context.projects.length).toBeGreaterThan(1);
  });

  it('builds onboarding context with visible projects', () => {
    const context = buildDevHarnessPortalOnboardingContext({ actorRole: 'pm' });

    expect(context.projects.length).toBeGreaterThan(0);
    expect(context.registrationState).toBe('registered');
  });

  it('normalizes registration payloads into a stable active project', () => {
    const result = buildDevHarnessPortalRegistrationResult({
      projectId: 'p001',
      projectIds: ['p001', 'p002', 'p001'],
    });

    expect(result).toEqual({
      ok: true,
      registrationState: 'registered',
      activeProjectId: 'p001',
      projectIds: ['p001', 'p002'],
    });
  });

  it('rejects session project switches for unknown projects', () => {
    expect(() => buildDevHarnessPortalSessionProjectResult('missing-project')).toThrow('project_not_found');
  });

  it('builds dashboard summary for a visible PM project', () => {
    const entry = buildDevHarnessPortalEntryContext({ actorId: 'u002', actorRole: 'pm' });
    const summary = buildDevHarnessPortalDashboardSummary({
      actorId: 'u002',
      actorRole: 'pm',
      projectId: entry.activeProjectId,
    });

    expect(summary.project.id).toBe(entry.activeProjectId);
    expect(summary.currentWeek?.label).toBeTruthy();
    expect(summary.financeSummaryItems).toHaveLength(4);
    expect(summary.submissionRows.length).toBeGreaterThan(0);
    expect(summary.surface.currentWeekLabel).toMatch(/주차$/);
  });

  it('rejects dashboard summary requests for unknown projects', () => {
    expect(() => buildDevHarnessPortalDashboardSummary({
      actorId: 'u002',
      actorRole: 'pm',
      projectId: 'missing-project',
    })).toThrow('project_not_found');
  });

  it('handles dashboard summary requests through the vite dev harness router', async () => {
    const response = await resolveDevHarnessPortalApiResponse({
      enabled: true,
      method: 'GET',
      url: '/api/v1/portal/dashboard-summary?projectId=p001',
      actorId: 'u002',
      actorRole: 'pm',
      readBody: async () => ({}),
    });

    expect(response.handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      project: { id: 'p001' },
      summary: { currentWeekLabel: expect.stringMatching(/주차$/) },
    });
  });

  it('builds payroll, weekly expenses, and bank statement summaries for a visible PM project', () => {
    const payroll = buildDevHarnessPortalPayrollSummary({ actorId: 'u002', actorRole: 'pm' });
    const weeklyExpenses = buildDevHarnessPortalWeeklyExpensesSummary({ actorId: 'u002', actorRole: 'pm' });
    const bankStatements = buildDevHarnessPortalBankStatementsSummary({ actorId: 'u002', actorRole: 'pm' });

    expect(payroll.currentRun?.projectId).toBe(payroll.project.id);
    expect(payroll.queue.length).toBeGreaterThan(0);

    expect(weeklyExpenses.expenseSheet.activeSheetName).toBe('기본 탭');
    expect(weeklyExpenses.bankStatement.rowCount).toBeGreaterThan(0);
    expect(weeklyExpenses.handoff.canOpenWeeklyExpenses).toBe(true);

    expect(bankStatements.bankStatement.profile).toBe('generic');
    expect(bankStatements.handoffContext.ready).toBe(true);
    expect(bankStatements.handoffContext.nextPath).toBe('/portal/weekly-expenses');
  });

  it('builds a weekly expense save command result for a visible PM project', () => {
    const result = buildDevHarnessPortalSaveWeeklyExpenseResult({
      actorId: 'u002',
      actorRole: 'pm',
      command: {
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        expectedVersion: 2,
        rows: [
          {
            tempId: 'row-1',
            cells: ['담당자', '1', '2026-04-14', '04-4-3'],
          },
        ],
        syncPlan: [
          {
            yearMonth: '2026-04',
            weekNo: 3,
            amounts: { DIRECT_COST_OUT: 120000 },
            reviewPendingCount: 0,
          },
          {
            yearMonth: '2026-04',
            weekNo: 4,
            amounts: { DIRECT_COST_OUT: 50000 },
            reviewPendingCount: 1,
          },
        ],
      },
    });

    expect(result.sheet).toMatchObject({
      id: 'default',
      projectId: 'p001',
      version: 3,
      rowCount: 1,
    });
    expect(result.syncSummary).toEqual({
      expenseSyncState: 'review_required',
      expenseReviewPendingCount: 1,
      syncedWeekCount: 1,
      reviewRequiredWeekCount: 1,
    });
    expect(result.weeklySubmissionStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        expenseSyncState: 'synced',
        expenseReviewPendingCount: 0,
      }),
      expect.objectContaining({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 4,
        expenseSyncState: 'review_required',
        expenseReviewPendingCount: 1,
      }),
    ]));
    expect(result.cashflowWeeks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'p001-2026-04-w3',
        projectId: 'p001',
        actual: { DIRECT_COST_OUT: 120000 },
      }),
      expect.objectContaining({
        id: 'p001-2026-04-w4',
        projectId: 'p001',
        actual: { DIRECT_COST_OUT: 50000 },
      }),
    ]));
  });

  it('builds a weekly submission submit command result for a visible PM project', () => {
    const result = buildDevHarnessPortalSubmitWeeklySubmissionResult({
      actorId: 'u002',
      actorRole: 'pm',
      command: {
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        transactionIds: ['tx-1', 'tx-2'],
      },
    });

    expect(result.cashflowWeek).toMatchObject({
      id: 'p001-2026-04-w3',
      projectId: 'p001',
      yearMonth: '2026-04',
      weekNo: 3,
      pmSubmitted: true,
    });
    expect(result.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-1',
        state: 'SUBMITTED',
        submittedBy: 'u002',
        version: 4,
      }),
      expect.objectContaining({
        id: 'tx-2',
        state: 'SUBMITTED',
        submittedBy: 'u002',
        version: 4,
      }),
    ]);
    expect(result.summary).toEqual({
      submittedTransactionCount: 2,
    });
  });

  it('builds a cashflow week close command result for a visible admin project', () => {
    const result = buildDevHarnessPortalCloseCashflowWeekResult({
      actorId: 'admin-1',
      actorRole: 'admin',
      command: {
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
      },
    });

    expect(result.cashflowWeek).toMatchObject({
      id: 'p001-2026-04-w3',
      projectId: 'p001',
      yearMonth: '2026-04',
      weekNo: 3,
      adminClosed: true,
    });
    expect(result.summary).toEqual({
      closedWeek: true,
    });
  });

  it('builds a bank handoff command result for a visible PM project', () => {
    const result = buildDevHarnessPortalBankStatementHandoffResult({
      actorId: 'u002',
      actorRole: 'pm',
      command: {
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        columns: ['통장번호', '거래일시'],
        rows: [{ tempId: 'bank-1', cells: ['111-222', '2026-04-16'] }],
      },
    });

    expect(result.bankStatement).toMatchObject({
      rowCount: 1,
      columnCount: 2,
    });
    expect(result.sheet).toMatchObject({
      id: 'default',
      projectId: 'p001',
    });
    expect(result.expenseIntakeItems).toHaveLength(1);
  });

  it('handles bank handoff through the vite dev harness router', async () => {
    const response = await resolveDevHarnessPortalApiResponse({
      enabled: true,
      method: 'POST',
      url: '/api/v1/portal/bank-statements/handoff',
      actorId: 'u002',
      actorRole: 'pm',
      readBody: async () => ({
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        columns: ['통장번호', '거래일시'],
        rows: [{ tempId: 'bank-1', cells: ['111-222', '2026-04-16'] }],
      }),
    });

    expect(response).toMatchObject({
      handled: true,
      statusCode: 200,
      payload: {
        bankStatement: {
          rowCount: 1,
          columnCount: 2,
        },
        sheet: {
          id: 'default',
          projectId: 'p001',
        },
      },
    });
  });

  it('handles phase1 read-model summary routes through the vite dev harness router', async () => {
    const [payroll, weeklyExpenses, bankStatements] = await Promise.all([
      resolveDevHarnessPortalApiResponse({
        enabled: true,
        method: 'GET',
        url: '/api/v1/portal/payroll-summary',
        actorId: 'u002',
        actorRole: 'pm',
        readBody: async () => ({}),
      }),
      resolveDevHarnessPortalApiResponse({
        enabled: true,
        method: 'GET',
        url: '/api/v1/portal/weekly-expenses-summary',
        actorId: 'u002',
        actorRole: 'pm',
        readBody: async () => ({}),
      }),
      resolveDevHarnessPortalApiResponse({
        enabled: true,
        method: 'GET',
        url: '/api/v1/portal/bank-statements-summary',
        actorId: 'u002',
        actorRole: 'pm',
        readBody: async () => ({}),
      }),
    ]);

    expect(payroll).toMatchObject({
      handled: true,
      statusCode: 200,
      payload: { project: { id: expect.any(String) }, summary: { queueCount: expect.any(Number) } },
    });
    expect(weeklyExpenses).toMatchObject({
      handled: true,
      statusCode: 200,
      payload: { expenseSheet: { activeSheetName: '기본 탭' } },
    });
    expect(bankStatements).toMatchObject({
      handled: true,
      statusCode: 200,
      payload: { handoffContext: { ready: true, nextPath: '/portal/weekly-expenses' } },
    });
  });

  it('handles weekly expense save through the vite dev harness router', async () => {
    const response = await resolveDevHarnessPortalApiResponse({
      enabled: true,
      method: 'POST',
      url: '/api/v1/portal/weekly-expenses/save',
      actorId: 'u002',
      actorRole: 'pm',
      readBody: async () => ({
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        expectedVersion: 2,
        rows: [
          {
            tempId: 'row-1',
            cells: ['담당자', '1', '2026-04-14', '04-4-3'],
          },
        ],
        syncPlan: [
          {
            yearMonth: '2026-04',
            weekNo: 3,
            amounts: { DIRECT_COST_OUT: 120000 },
            reviewPendingCount: 0,
          },
        ],
      }),
    });

    expect(response).toMatchObject({
      handled: true,
      statusCode: 200,
      payload: {
        sheet: {
          id: 'default',
          projectId: 'p001',
        },
        syncSummary: {
          expenseSyncState: 'synced',
          expenseReviewPendingCount: 0,
          syncedWeekCount: 1,
          reviewRequiredWeekCount: 0,
        },
      },
    });
  });

  it('handles weekly submission submit through the vite dev harness router', async () => {
    const response = await resolveDevHarnessPortalApiResponse({
      enabled: true,
      method: 'POST',
      url: '/api/v1/portal/weekly-submissions/submit',
      actorId: 'u002',
      actorRole: 'pm',
      readBody: async () => ({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        transactionIds: ['tx-1'],
      }),
    });

    expect(response).toMatchObject({
      handled: true,
      statusCode: 200,
      payload: {
        cashflowWeek: {
          id: 'p001-2026-04-w3',
          projectId: 'p001',
          pmSubmitted: true,
        },
        transactions: [
          expect.objectContaining({
            id: 'tx-1',
            state: 'SUBMITTED',
          }),
        ],
        summary: {
          submittedTransactionCount: 1,
        },
      },
    });
  });

  it('handles cashflow week close through the vite dev harness router', async () => {
    const response = await resolveDevHarnessPortalApiResponse({
      enabled: true,
      method: 'POST',
      url: '/api/v1/cashflow/weeks/close',
      actorId: 'admin-1',
      actorRole: 'admin',
      readBody: async () => ({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
      }),
    });

    expect(response).toMatchObject({
      handled: true,
      statusCode: 200,
      payload: {
        cashflowWeek: {
          id: 'p001-2026-04-w3',
          projectId: 'p001',
          adminClosed: true,
        },
        summary: {
          closedWeek: true,
        },
      },
    });
  });
});
