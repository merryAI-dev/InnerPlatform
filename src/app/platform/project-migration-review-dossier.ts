import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  normalizeAccountType,
  normalizeBasis,
  normalizeProjectContractType,
  normalizeProjectCurrency,
  normalizeProjectFundInputMode,
  normalizeProjectType,
  normalizeSettlementType,
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_CURRENCY_LABELS,
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
import { resolveProjectRequestKind } from './project-change-request';

export interface MigrationReviewDossier {
  headerTitle: string;
  identity: {
    clientOrg: string;
    cic: string;
    pmName: string;
    department: string;
    officialContractName: string;
    groupwareName: string;
  };
  contract: {
    projectTypeLabel: string;
    periodLabel: string;
    contractType: string;
    settlementTypeLabel: string;
    basisLabel: string;
    accountTypeLabel: string;
    fundInputModeLabel: string;
  };
  budget: {
    currencyLabel: string;
    contractAmountLabel: string;
    salesVatAmountLabel: string;
    paymentPlanDesc: string;
    paymentPlanSplitLabel: string;
    finalPaymentNote: string;
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
    requestSummary: string;
    requestVersion: string;
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
      changes: Array<{
        key: string;
        label: string;
        before: string;
        after: string;
      }>;
    }>;
  };
  changes: Array<{
    key: string;
    label: string;
    before: string;
    after: string;
  }>;
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

function formatPaymentPlanSplit(
  plan: Project['paymentPlan'] | ProjectRequest['payload']['paymentPlan'] | null | undefined,
  contractAmount: number | null | undefined,
): string {
  if (!plan) return '-';
  const normalizedContractAmount = Number(contractAmount);
  const entries = [
    ['선금/계약금', plan.contract],
    ['중도금', plan.interim],
    ['잔금', plan.final],
  ] as const;
  const label = entries
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([name, value]) => {
      const amount = Number(value);
      const percent = Number.isFinite(normalizedContractAmount) && normalizedContractAmount > 0
        ? ` (${((amount / normalizedContractAmount) * 100).toFixed(0)}%)`
        : '';
      return `${name} ${amount.toLocaleString('ko-KR')}원${percent}`;
    })
    .join(' · ');
  return label || '-';
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
        changes: normalizeReviewChanges(entry.changes),
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
    changes: [],
  }];
}

function normalizeReviewChanges(value: ProjectExecutiveReviewHistoryEntry['changes']) {
  return (Array.isArray(value) ? value : [])
    .map((change) => ({
      key: readable(change?.key, 'change'),
      label: readable(change?.label, '변경 항목'),
      before: readable(change?.before),
      after: readable(change?.after),
    }))
    .filter((change) => change.before !== change.after);
}

function findLatestReviewChanges(history: ReturnType<typeof buildAuditHistory>) {
  return history.find((entry) => entry.changes.length > 0)?.changes || [];
}

function readReviewChangesFromRequest(request: ProjectRequest | null) {
  return normalizeReviewChanges(request?.changedFields);
}

function preferRequestPayloadForChange<T>(
  request: ProjectRequest | null,
  projectValue: T,
  payloadValue: T | undefined,
): T | undefined {
  return resolveProjectRequestKind(request) === 'CHANGE'
    ? (payloadValue ?? projectValue)
    : (projectValue ?? payloadValue);
}

export function buildMigrationReviewDossier(
  project: Project,
  request: ProjectRequest | null,
): MigrationReviewDossier {
  const payload = request?.payload;
  const usePayloadAsCurrent = resolveProjectRequestKind(request) === 'CHANGE' && request?.status === 'PENDING';
  const contractDocument = preferRequestPayloadForChange(request, project.contractDocument, payload?.contractDocument) || null;
  const contractAnalysis = preferRequestPayloadForChange(request, project.contractAnalysis, payload?.contractAnalysis) || null;
  const currentName = preferRequestPayloadForChange(request, project.name, payload?.name);
  const currentOfficialContractName = preferRequestPayloadForChange(request, project.officialContractName, payload?.officialContractName);
  const currentClientOrg = preferRequestPayloadForChange(request, project.clientOrg, payload?.clientOrg);
  const currentDepartment = preferRequestPayloadForChange(request, project.department, payload?.department);
  const currentManagerName = preferRequestPayloadForChange(request, project.registeredByName || project.managerName, payload?.registeredByName || payload?.managerName);
  const currentTeamName = preferRequestPayloadForChange(request, project.teamName, payload?.teamName);
  const rawMembers = usePayloadAsCurrent && Array.isArray(payload?.teamMembersDetailed)
    ? payload?.teamMembersDetailed
    : Array.isArray(project.teamMembersDetailed)
      ? project.teamMembersDetailed
      : payload?.teamMembersDetailed;
  const members = Array.isArray(rawMembers)
    ? normalizeProjectTeamMembers(rawMembers).map(formatProjectTeamMemberLine)
    : readable(payload?.teamMembers, '')
        .split(/[,\n]/)
        .map((member) => member.trim())
        .filter(Boolean);
  const auditHistory = buildAuditHistory(project, request);
  const changes = readReviewChangesFromRequest(request).length > 0
    ? readReviewChangesFromRequest(request)
    : findLatestReviewChanges(auditHistory);

  return {
    headerTitle: readable(currentName),
    identity: {
      clientOrg: readable(currentClientOrg),
      cic: readable(project.cic || currentDepartment),
      pmName: readable(currentManagerName),
      department: readable(currentDepartment),
      officialContractName: readable(currentOfficialContractName || currentName),
      groupwareName: readable(preferRequestPayloadForChange(request, project.groupwareName, payload?.groupwareName)),
    },
    contract: {
      projectTypeLabel: PROJECT_TYPE_LABELS[normalizeProjectType(preferRequestPayloadForChange(request, project.type, payload?.type))] || readable(project.type || payload?.type),
      periodLabel: `${readable(preferRequestPayloadForChange(request, project.contractStart, payload?.contractStart))} ~ ${readable(preferRequestPayloadForChange(request, project.contractEnd, payload?.contractEnd))}`,
      contractType: readable(normalizeProjectContractType(preferRequestPayloadForChange(request, project.contractType, payload?.contractType))),
      settlementTypeLabel: SETTLEMENT_TYPE_LABELS[normalizeSettlementType(preferRequestPayloadForChange(request, project.settlementType, payload?.settlementType))] || '-',
      basisLabel: BASIS_LABELS[normalizeBasis(preferRequestPayloadForChange(request, project.basis, payload?.basis))] || '-',
      accountTypeLabel: ACCOUNT_TYPE_LABELS[normalizeAccountType(preferRequestPayloadForChange(request, project.accountType, payload?.accountType))] || '-',
      fundInputModeLabel: PROJECT_FUND_INPUT_MODE_LABELS[normalizeProjectFundInputMode(preferRequestPayloadForChange(request, project.fundInputMode, payload?.fundInputMode))] || '-',
    },
    budget: {
      currencyLabel: PROJECT_CURRENCY_LABELS[normalizeProjectCurrency(preferRequestPayloadForChange(request, project.currency, payload?.currency))] || 'KRW',
      contractAmountLabel: formatStoredProjectAmount(preferRequestPayloadForChange(request, project.contractAmount, payload?.contractAmount)),
      salesVatAmountLabel: formatStoredProjectAmount(preferRequestPayloadForChange(request, project.salesVatAmount, payload?.salesVatAmount)),
      paymentPlanDesc: readable(preferRequestPayloadForChange(request, project.paymentPlanDesc, payload?.paymentPlanDesc)),
      paymentPlanSplitLabel: formatPaymentPlanSplit(
        preferRequestPayloadForChange(request, project.paymentPlan, payload?.paymentPlan),
        preferRequestPayloadForChange(request, project.contractAmount, payload?.contractAmount),
      ),
      finalPaymentNote: readable(preferRequestPayloadForChange(request, project.finalPaymentNote, payload?.finalPaymentNote)),
      totalRevenueAmountLabel: formatStoredProjectAmount(preferRequestPayloadForChange(request, project.totalRevenueAmount, payload?.totalRevenueAmount)),
      supportAmountLabel: formatStoredProjectAmount(preferRequestPayloadForChange(request, project.supportAmount, payload?.supportAmount)),
    },
    people: {
      teamName: readable(currentTeamName),
      members,
    },
    notes: {
      description: readable(preferRequestPayloadForChange(request, project.description, payload?.description)),
      projectPurpose: readable(preferRequestPayloadForChange(request, project.projectPurpose, payload?.projectPurpose)),
      participantCondition: readable(preferRequestPayloadForChange(request, project.participantCondition, payload?.participantCondition)),
      note: readable(payload?.note),
    },
    audit: {
      requestSummary: readable(request?.humanSummary),
      requestVersion: request?.requestVersion ? `v${request.requestVersion}` : '-',
      requestedByName: readable(request?.requestedByName),
      requestedAt: formatDate(request?.requestedAt),
      reviewedByName: readable(project.executiveReviewedByName || request?.reviewedByName),
      reviewedAt: formatDate(project.executiveReviewedAt || request?.reviewedAt),
      reviewComment: readable(project.executiveReviewComment || request?.reviewComment || request?.rejectedReason),
      history: auditHistory,
    },
    changes,
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
