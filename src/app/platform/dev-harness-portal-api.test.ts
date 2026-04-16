import { describe, expect, it } from 'vitest';
import { resolveDevHarnessPortalApiResponse } from '../../../vite.config';
import {
  buildDevHarnessPortalBankStatementsSummary,
  buildDevHarnessPortalDashboardSummary,
  buildDevHarnessPortalEntryContext,
  buildDevHarnessPortalOnboardingContext,
  buildDevHarnessPortalPayrollSummary,
  buildDevHarnessPortalRegistrationResult,
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
});
