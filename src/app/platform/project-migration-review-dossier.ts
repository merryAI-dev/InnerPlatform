import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_TYPE_LABELS,
  type ProjectExecutiveReviewHistoryEntry,
  SETTLEMENT_TYPE_LABELS,
  type Project,
  type ProjectRequest,
} from '../data/types';
import {
  formatProjectTeamMemberLine,
  normalizeProjectTeamMembers,
} from './project-team-members';
import { getMigrationAuditStatusLabel } from './project-migration-console';

export interface MigrationReviewDossier {
  headerTitle: string;
  identity: {
    clientOrg: string;
    cic: string;
    pmName: string;
    department: string;
    officialContractName: string;
  };
  contract: {
    projectTypeLabel: string;
    periodLabel: string;
    settlementTypeLabel: string;
    basisLabel: string;
    accountTypeLabel: string;
    fundInputModeLabel: string;
  };
  budget: {
    contractAmountLabel: string;
    salesVatAmountLabel: string;
    paymentPlanDesc: string;
    totalRevenueAmountLabel: string;
    supportAmountLabel: string;
  };
  people: {
    teamName: string;
    members: string[];
  };
  notes: {
    description: string;
    projectPurpose: string;
    participantCondition: string;
    note: string;
  };
  audit: {
    requestedByName: string;
    requestedAt: string;
    reviewedByName: string;
    reviewedAt: string;
    reviewComment: string;
    history: Array<{
      statusLabel: string;
      reviewedByName: string;
      reviewedAt: string;
      reviewComment: string;
    }>;
  };
  analysis: {
    summary: string;
    warnings: string[];
    nextActions: string[];
  };
  contractDocument: {
    name: string;
    downloadURL: string;
    uploadedAt: string;
  };
}

function readable(value: string | null | undefined, fallback = '-') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function formatStoredProjectAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Number(value).toLocaleString('ko-KR')}원`;
}

function formatDate(value: string | null | undefined): string {
  const normalized = readable(value, '');
  if (!normalized) return '-';
  return normalized.slice(0, 10).replace(/-/g, '.');
}

function buildAuditHistory(project: Project, request: ProjectRequest | null) {
  const history = Array.isArray(project.executiveReviewHistory) ? project.executiveReviewHistory : [];
  if (history.length > 0) {
    return [...history]
      .sort((left, right) => String(right.reviewedAt || '').localeCompare(String(left.reviewedAt || '')))
      .map((entry: ProjectExecutiveReviewHistoryEntry) => ({
        statusLabel: getMigrationAuditStatusLabel(entry.status),
        reviewedByName: readable(entry.reviewedByName),
        reviewedAt: formatDate(entry.reviewedAt),
        reviewComment: readable(entry.reviewComment),
      }));
  }

  const fallbackStatus = project.executiveReviewStatus || request?.reviewOutcome;
  const fallbackReviewedAt = project.executiveReviewedAt || request?.reviewedAt;
  const fallbackReviewedByName = project.executiveReviewedByName || request?.reviewedByName;
  const fallbackReviewComment = project.executiveReviewComment || request?.reviewComment || request?.rejectedReason;
  if (!fallbackStatus && !fallbackReviewedAt && !fallbackReviewedByName && !fallbackReviewComment) {
    return [];
  }

  return [{
    statusLabel: getMigrationAuditStatusLabel((fallbackStatus || 'PENDING') as any),
    reviewedByName: readable(fallbackReviewedByName),
    reviewedAt: formatDate(fallbackReviewedAt),
    reviewComment: readable(fallbackReviewComment),
  }];
}

export function buildMigrationReviewDossier(
  project: Project,
  request: ProjectRequest | null,
): MigrationReviewDossier {
  const payload = request?.payload;
  const contractDocument = project.contractDocument || payload?.contractDocument || null;
  const contractAnalysis = project.contractAnalysis || payload?.contractAnalysis || null;
  const rawMembers = payload?.teamMembersDetailed || project.teamMembersDetailed;
  const members = rawMembers && rawMembers.length > 0
    ? normalizeProjectTeamMembers(rawMembers).map(formatProjectTeamMemberLine)
    : readable(payload?.teamMembers, '')
        .split(/[,\n]/)
        .map((member) => member.trim())
        .filter(Boolean);
  const auditHistory = buildAuditHistory(project, request);

  return {
    headerTitle: readable(project.name),
    identity: {
      clientOrg: readable(project.clientOrg || payload?.clientOrg),
      cic: readable(project.cic || project.department || payload?.department),
      pmName: readable(project.managerName || payload?.managerName),
      department: readable(project.department || payload?.department),
      officialContractName: readable(project.officialContractName || payload?.officialContractName || project.name),
    },
    contract: {
      projectTypeLabel: PROJECT_TYPE_LABELS[project.type || payload?.type] || readable(project.type || payload?.type),
      periodLabel: `${readable(project.contractStart || payload?.contractStart)} ~ ${readable(project.contractEnd || payload?.contractEnd)}`,
      settlementTypeLabel: SETTLEMENT_TYPE_LABELS[project.settlementType || payload?.settlementType] || '-',
      basisLabel: BASIS_LABELS[project.basis || payload?.basis] || '-',
      accountTypeLabel: ACCOUNT_TYPE_LABELS[project.accountType || payload?.accountType] || '-',
      fundInputModeLabel: PROJECT_FUND_INPUT_MODE_LABELS[project.fundInputMode || payload?.fundInputMode || 'BANK_UPLOAD'] || '-',
    },
    budget: {
      contractAmountLabel: formatStoredProjectAmount(project.contractAmount ?? payload?.contractAmount),
      salesVatAmountLabel: formatStoredProjectAmount(project.salesVatAmount ?? payload?.salesVatAmount),
      paymentPlanDesc: readable(project.paymentPlanDesc || payload?.paymentPlanDesc),
      totalRevenueAmountLabel: formatStoredProjectAmount(project.totalRevenueAmount ?? payload?.totalRevenueAmount),
      supportAmountLabel: formatStoredProjectAmount(project.supportAmount ?? payload?.supportAmount),
    },
    people: {
      teamName: readable(project.teamName || payload?.teamName),
      members,
    },
    notes: {
      description: readable(project.description || payload?.description),
      projectPurpose: readable(project.projectPurpose || payload?.projectPurpose),
      participantCondition: readable(project.participantCondition || payload?.participantCondition),
      note: readable(payload?.note),
    },
    audit: {
      requestedByName: readable(request?.requestedByName),
      requestedAt: formatDate(request?.requestedAt),
      reviewedByName: readable(project.executiveReviewedByName || request?.reviewedByName),
      reviewedAt: formatDate(project.executiveReviewedAt || request?.reviewedAt),
      reviewComment: readable(project.executiveReviewComment || request?.reviewComment || request?.rejectedReason),
      history: auditHistory,
    },
    analysis: {
      summary: readable(contractAnalysis?.summary),
      warnings: contractAnalysis?.warnings || [],
      nextActions: contractAnalysis?.nextActions || [],
    },
    contractDocument: {
      name: readable(contractDocument?.name),
      downloadURL: readable(contractDocument?.downloadURL),
      uploadedAt: formatDate(contractDocument?.uploadedAt),
    },
  };
}
