import { describe, expect, it } from 'vitest';
import { resolveAdminMonitoringIssues } from './admin-monitoring';

describe('admin monitoring helper', () => {
  it('ranks critical issues ahead of lower-severity issues and orders by count within severity', () => {
    const issues = resolveAdminMonitoringIssues({
      dataSourceHealthy: false,
      pendingApprovalCount: 2,
      missingEvidenceCount: 7,
      rejectedTransactionCount: 1,
      hrAlertCount: 3,
      payrollRiskCount: 5,
      payrollMissingCandidateCount: 2,
      payrollReviewPendingCount: 4,
      payrollFinalUnconfirmedCount: 1,
      participationRiskCount: 4,
      missingPmCount: 6,
      cashflowVarianceCount: 0,
      staleProjectCount: 0,
    });

    expect(issues.map((issue) => issue.key)).toEqual([
      'missing_evidence',
      'payroll_risk',
      'payroll_missing_candidate',
      'participation_risk',
      'data_source',
      'payroll_review_pending',
      'missing_pm',
      'hr_alerts',
      'pending_approvals',
      'payroll_final_unconfirmed',
      'rejected_transactions',
    ]);
    expect(issues[0]).toMatchObject({
      label: '증빙 누락',
      count: 7,
      severity: 'critical',
      to: '/evidence',
    });
    expect(issues.find((issue) => issue.key === 'payroll_missing_candidate')).toMatchObject({
      label: '인건비 후보 없음',
      count: 2,
      severity: 'critical',
      to: '/payroll',
    });
    expect(issues.find((issue) => issue.key === 'payroll_review_pending')).toMatchObject({
      label: 'PM 검토 대기',
      count: 4,
      severity: 'warning',
      to: '/payroll',
    });
    expect(issues.find((issue) => issue.key === 'payroll_final_unconfirmed')).toMatchObject({
      label: '최종 확정 대기',
      count: 1,
      severity: 'warning',
      to: '/payroll',
    });
    expect(issues.find((issue) => issue.key === 'data_source')).toMatchObject({
      label: '데이터 소스',
      count: 1,
      to: '/settings',
    });
  });

  it('omits zero-count items and keeps each issue actionable', () => {
    const issues = resolveAdminMonitoringIssues({
      dataSourceHealthy: true,
      pendingApprovalCount: 0,
      missingEvidenceCount: 0,
      rejectedTransactionCount: 0,
      hrAlertCount: 0,
      payrollRiskCount: 0,
      payrollMissingCandidateCount: 0,
      payrollReviewPendingCount: 0,
      payrollFinalUnconfirmedCount: 0,
      participationRiskCount: 4,
      missingPmCount: 2,
      cashflowVarianceCount: 3,
      staleProjectCount: 1,
    });

    expect(issues.map((issue) => issue.key)).toEqual([
      'participation_risk',
      'cashflow_variance',
      'missing_pm',
      'stale_projects',
    ]);
    expect(issues.map((issue) => issue.to)).toEqual([
      '/participation',
      '/cashflow/analytics',
      '/cashflow/weekly',
      '/projects',
    ]);
  });
});
