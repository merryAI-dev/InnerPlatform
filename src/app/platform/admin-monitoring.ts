export type AdminMonitoringSeverity = 'critical' | 'warning' | 'info';

export type AdminMonitoringIssueKey =
  | 'missing_evidence'
  | 'payroll_risk'
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
  payroll_risk: 1,
  participation_risk: 2,
  data_source: 3,
  cashflow_variance: 4,
  hr_alerts: 5,
  pending_approvals: 6,
  rejected_transactions: 7,
  missing_pm: 8,
  stale_projects: 9,
};

function normalizeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function buildIssue(blueprint: IssueBlueprint): AdminMonitoringIssue & { score: number } {
  return {
    ...blueprint,
    score: SEVERITY_WEIGHT[blueprint.severity] + (blueprint.count * 10) - ISSUE_PRIORITY[blueprint.key],
  };
}

export function resolveAdminMonitoringIssues(input: Partial<AdminMonitoringCounts>): AdminMonitoringIssue[] {
  const issues: Array<AdminMonitoringIssue & { score: number }> = [];

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
    normalizeCount(input.payrollRiskCount) > 0 ? {
      key: 'payroll_risk',
      label: '인건비 위험',
      count: normalizeCount(input.payrollRiskCount),
      severity: 'critical',
      to: '/payroll',
      detail: `${normalizeCount(input.payrollRiskCount)}건 지급 위험이 감지되었습니다.`,
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
      to: '/cashflow',
      detail: `${normalizeCount(input.cashflowVarianceCount)}개 사업에서 시트 편차가 감지되었습니다.`,
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
      to: '/cashflow',
      detail: `${normalizeCount(input.missingPmCount)}개 사업에 이번 주 PM 입력이 없습니다.`,
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
      right.score - left.score
      || right.count - left.count
      || ISSUE_PRIORITY[left.key] - ISSUE_PRIORITY[right.key]
    ))
    .map(({ score: _score, ...issue }) => issue);
}
