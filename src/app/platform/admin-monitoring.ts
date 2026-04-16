export type AdminMonitoringSeverity = 'critical' | 'warning' | 'info';

export type AdminMonitoringIssueKey =
  | 'missing_evidence'
  | 'payroll_pm_amount_missing'
  | 'payroll_projection_missing'
  | 'payroll_amount_mismatch'
  | 'payroll_projection_shortfall'
  | 'payroll_pm_shortfall'
  | 'payroll_risk'
  | 'payroll_review_pending'
  | 'payroll_missing_candidate'
  | 'payroll_final_unconfirmed'
  | 'participation_risk'
  | 'data_source'
  | 'cashflow_variance'
  | 'hr_alerts'
  | 'pending_approvals'
  | 'rejected_transactions'
  | 'missing_pm'
  | 'stale_projects';

export interface AdminMonitoringIssue {
  key: AdminMonitoringIssueKey;
  label: string;
  count: number;
  severity: AdminMonitoringSeverity;
  detail: string;
  to: string;
}

export interface AdminMonitoringCounts {
  dataSourceHealthy: boolean;
  missingEvidenceCount: number;
  payrollRiskCount: number;
  payrollPmAmountMissingCount: number;
  payrollProjectionMissingCount: number;
  payrollAmountMismatchCount: number;
  payrollProjectionShortfallCount: number;
  payrollPmShortfallCount: number;
  payrollReviewPendingCount: number;
  payrollMissingCandidateCount: number;
  payrollFinalUnconfirmedCount: number;
  participationRiskCount: number;
  pendingApprovalCount: number;
  rejectedTransactionCount: number;
  hrAlertCount: number;
  missingPmCount: number;
  cashflowVarianceCount: number;
  staleProjectCount: number;
}

interface IssueBlueprint {
  key: AdminMonitoringIssueKey;
  label: string;
  count: number;
  severity: AdminMonitoringSeverity;
  to: string;
  detail: string;
}

const SEVERITY_WEIGHT: Record<AdminMonitoringSeverity, number> = {
  critical: 3000,
  warning: 2000,
  info: 1000,
};

const ISSUE_PRIORITY: Record<AdminMonitoringIssueKey, number> = {
  missing_evidence: 0,
  payroll_amount_mismatch: 1,
  payroll_projection_shortfall: 2,
  payroll_risk: 3,
  payroll_projection_missing: 4,
  payroll_pm_amount_missing: 5,
  payroll_pm_shortfall: 6,
  payroll_missing_candidate: 7,
  participation_risk: 8,
  data_source: 9,
  payroll_review_pending: 10,
  cashflow_variance: 11,
  missing_pm: 12,
  hr_alerts: 13,
  pending_approvals: 14,
  payroll_final_unconfirmed: 15,
  rejected_transactions: 16,
  stale_projects: 17,
};

function normalizeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function buildIssue(blueprint: IssueBlueprint): AdminMonitoringIssue {
  return {
    ...blueprint,
  };
}

export function resolveAdminMonitoringIssues(input: Partial<AdminMonitoringCounts>): AdminMonitoringIssue[] {
  const issues: AdminMonitoringIssue[] = [];

  if (input.dataSourceHealthy === false) {
    issues.push(buildIssue({
      key: 'data_source',
      label: '데이터 소스',
      count: 1,
      severity: 'critical',
      to: '/settings',
      detail: 'Firestore 연결이 끊겼습니다.',
    }));
  }

  const blueprints: Array<IssueBlueprint | null> = [
    normalizeCount(input.missingEvidenceCount) > 0 ? {
      key: 'missing_evidence',
      label: '증빙 누락',
      count: normalizeCount(input.missingEvidenceCount),
      severity: 'critical',
      to: '/evidence',
      detail: `${normalizeCount(input.missingEvidenceCount)}건 증빙이 아직 완료되지 않았습니다.`,
    } : null,
    normalizeCount(input.payrollAmountMismatchCount) > 0 ? {
      key: 'payroll_amount_mismatch',
      label: '인건비 금액 불일치',
      count: normalizeCount(input.payrollAmountMismatchCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollAmountMismatchCount)}개 사업에서 PM 입력 금액과 캐시플로 Projection이 다릅니다.`,
    } : null,
    normalizeCount(input.payrollProjectionShortfallCount) > 0 ? {
      key: 'payroll_projection_shortfall',
      label: 'Projection 기준 잔액 부족',
      count: normalizeCount(input.payrollProjectionShortfallCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollProjectionShortfallCount)}개 사업에서 Projection 기준 인건비 잔액이 부족합니다.`,
    } : null,
    normalizeCount(input.payrollRiskCount) > 0 ? {
      key: 'payroll_risk',
      label: '인건비 위험',
      count: normalizeCount(input.payrollRiskCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollRiskCount)}건 지급 위험이 감지되었습니다.`,
    } : null,
    normalizeCount(input.payrollProjectionMissingCount) > 0 ? {
      key: 'payroll_projection_missing',
      label: 'Projection 금액 없음',
      count: normalizeCount(input.payrollProjectionMissingCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollProjectionMissingCount)}개 사업에서 참조할 캐시플로 Projection이 없습니다.`,
    } : null,
    normalizeCount(input.payrollPmAmountMissingCount) > 0 ? {
      key: 'payroll_pm_amount_missing',
      label: 'PM 입력 금액 없음',
      count: normalizeCount(input.payrollPmAmountMissingCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollPmAmountMissingCount)}개 사업에서 PM이 이번 달 인건비 금액을 아직 입력하지 않았습니다.`,
    } : null,
    normalizeCount(input.payrollPmShortfallCount) > 0 ? {
      key: 'payroll_pm_shortfall',
      label: 'PM 기준 잔액 부족',
      count: normalizeCount(input.payrollPmShortfallCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollPmShortfallCount)}개 사업에서 PM 입력 인건비 기준 잔액이 부족합니다.`,
    } : null,
    normalizeCount(input.payrollMissingCandidateCount) > 0 ? {
      key: 'payroll_missing_candidate',
      label: '인건비 후보 없음',
      count: normalizeCount(input.payrollMissingCandidateCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollMissingCandidateCount)}건에서 PM이 확인할 지급 후보를 찾지 못했습니다.`,
    } : null,
    normalizeCount(input.participationRiskCount) > 0 ? {
      key: 'participation_risk',
      label: '참여율 위험',
      count: normalizeCount(input.participationRiskCount),
      severity: 'critical',
      to: '/participation',
      detail: `${normalizeCount(input.participationRiskCount)}명 환수 위험이 있습니다.`,
    } : null,
    normalizeCount(input.cashflowVarianceCount) > 0 ? {
      key: 'cashflow_variance',
      label: '캐시플로 편차',
      count: normalizeCount(input.cashflowVarianceCount),
      severity: 'warning',
      to: '/cashflow/analytics',
      detail: `${normalizeCount(input.cashflowVarianceCount)}개 사업에서 시트 편차가 감지되었습니다.`,
    } : null,
    normalizeCount(input.payrollReviewPendingCount) > 0 ? {
      key: 'payroll_review_pending',
      label: 'PM 검토 대기',
      count: normalizeCount(input.payrollReviewPendingCount),
      severity: 'warning',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollReviewPendingCount)}건 인건비 적요 검토가 아직 완료되지 않았습니다.`,
    } : null,
    normalizeCount(input.hrAlertCount) > 0 ? {
      key: 'hr_alerts',
      label: '미확인 공지',
      count: normalizeCount(input.hrAlertCount),
      severity: 'warning',
      to: '/hr-announcements',
      detail: `${normalizeCount(input.hrAlertCount)}건 인사 공지가 아직 미처리입니다.`,
    } : null,
    normalizeCount(input.pendingApprovalCount) > 0 ? {
      key: 'pending_approvals',
      label: '승인 대기',
      count: normalizeCount(input.pendingApprovalCount),
      severity: 'warning',
      to: '/approvals',
      detail: `${normalizeCount(input.pendingApprovalCount)}건 승인 대기가 남아 있습니다.`,
    } : null,
    normalizeCount(input.rejectedTransactionCount) > 0 ? {
      key: 'rejected_transactions',
      label: '반려 거래',
      count: normalizeCount(input.rejectedTransactionCount),
      severity: 'warning',
      to: '/audit',
      detail: `${normalizeCount(input.rejectedTransactionCount)}건 반려 거래를 다시 확인해야 합니다.`,
    } : null,
    normalizeCount(input.missingPmCount) > 0 ? {
      key: 'missing_pm',
      label: '미입력 PM',
      count: normalizeCount(input.missingPmCount),
      severity: 'warning',
      to: '/cashflow/weekly',
      detail: `${normalizeCount(input.missingPmCount)}개 사업에 이번 주 PM 입력이 없습니다.`,
    } : null,
    normalizeCount(input.payrollFinalUnconfirmedCount) > 0 ? {
      key: 'payroll_final_unconfirmed',
      label: '최종 확정 대기',
      count: normalizeCount(input.payrollFinalUnconfirmedCount),
      severity: 'warning',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollFinalUnconfirmedCount)}건은 PM 검토 후 최종 확정이 남아 있습니다.`,
    } : null,
    normalizeCount(input.staleProjectCount) > 0 ? {
      key: 'stale_projects',
      label: '갱신 지연',
      count: normalizeCount(input.staleProjectCount),
      severity: 'warning',
      to: '/projects',
      detail: `${normalizeCount(input.staleProjectCount)}개 사업이 오래 갱신되지 않았습니다.`,
    } : null,
  ];

  for (const blueprint of blueprints) {
    if (!blueprint) continue;
    issues.push(buildIssue(blueprint));
  }

  return issues
    .sort((left, right) => (
      SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity]
      || ISSUE_PRIORITY[left.key] - ISSUE_PRIORITY[right.key]
      || right.count - left.count
      || left.label.localeCompare(right.label)
    ))
    .map((issue) => issue);
}
