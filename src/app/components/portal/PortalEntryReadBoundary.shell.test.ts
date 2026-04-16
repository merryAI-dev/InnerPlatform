import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPortalSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

const dashboardSource = readPortalSource('PortalDashboard.tsx');
const payrollSource = readPortalSource('PortalPayrollPage.tsx');
const weeklyExpenseSource = readPortalSource('PortalWeeklyExpensePage.tsx');
const bankStatementSource = readPortalSource('PortalBankStatementPage.tsx');

describe('portal entry read boundary', () => {
  it('hydrates dashboard surface from the portal dashboard summary BFF contract', () => {
    expect(dashboardSource).toContain('createPlatformApiClient(import.meta.env)');
    expect(dashboardSource).toContain('fetchPortalDashboardSummaryViaBff');
    expect(dashboardSource).toContain('dashboardSummary');
    const portalStoreDestructure = dashboardSource.match(
      /const\s*\{([\s\S]*?)\}\s*=\s*usePortalStore\(\);/,
    );

    expect(portalStoreDestructure?.[1]).toBeDefined();
    const destructuredPortalStoreFields = portalStoreDestructure?.[1]
      ?.split(',')
      .map((field) => field.trim())
      .filter(Boolean)
      .sort();

    expect(destructuredPortalStoreFields).toEqual(['isLoading', 'myProject', 'portalUser']);
  });

  it('hydrates payroll surface from the portal payroll summary BFF contract', () => {
    expect(payrollSource).toContain('createPlatformApiClient(import.meta.env)');
    expect(payrollSource).toContain('fetchPortalPayrollSummaryViaBff');
    expect(payrollSource).toContain('payrollSummary');
  });

  it('hydrates weekly expense project summary and handoff context from the portal weekly summary BFF contract', () => {
    expect(weeklyExpenseSource).toContain('createPlatformApiClient(import.meta.env)');
    expect(weeklyExpenseSource).toContain('fetchPortalWeeklyExpensesSummaryViaBff');
    expect(weeklyExpenseSource).not.toContain('fetchPortalEntryContextViaBff');
    expect(weeklyExpenseSource).toContain('weeklySummary');
  });

  it('hydrates bank statement project summary and readiness context from the portal bank summary BFF contract', () => {
    expect(bankStatementSource).toContain('createPlatformApiClient(import.meta.env)');
    expect(bankStatementSource).toContain('fetchPortalBankStatementsSummaryViaBff');
    expect(bankStatementSource).not.toContain('fetchPortalEntryContextViaBff');
    expect(bankStatementSource).toContain('bankStatementsSummary');
  });
});
