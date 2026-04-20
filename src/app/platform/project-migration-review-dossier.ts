import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  type Project,
} from '../data/types';
import type { MigrationAuditConsoleRecord } from './project-migration-console';
import { formatStoredProjectAmount } from './project-contract-amount';
import {
  formatProjectTeamMemberLine,
  normalizeProjectTeamMembers,
} from './project-team-members';

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
  };
  people: {
    teamName: string;
    members: string[];
  };
  notes: {
    projectPurpose: string;
    participantCondition: string;
  };
}

function readable(value: string | null | undefined, fallback = '-') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

export function buildMigrationReviewDossier(
  record: MigrationAuditConsoleRecord,
  project: Project | null,
): MigrationReviewDossier {
  const coreMembers = readable(record.candidate.coreMembers, '');
  const candidateMembers = coreMembers
    .split(/[,\n]/)
    .map((member) => member.trim())
    .filter(Boolean);

  return {
    headerTitle: readable(project?.name || record.sourceName),
    identity: {
      clientOrg: readable(project?.clientOrg || record.sourceClientOrg),
      cic: readable(project?.cic || project?.department || record.cic),
      pmName: readable(project?.managerName || record.candidate.coreMembers),
      department: readable(project?.department || record.sourceDepartment),
      officialContractName: readable(project?.officialContractName || project?.name || record.candidate.groupwareProjectName),
    },
    contract: {
      projectTypeLabel: project ? (PROJECT_TYPE_LABELS[project.type] || readable(project.type)) : '-',
      periodLabel: project ? `${readable(project.contractStart)} ~ ${readable(project.contractEnd)}` : '-',
      settlementTypeLabel: project ? (SETTLEMENT_TYPE_LABELS[project.settlementType] || '-') : '-',
      basisLabel: project ? (BASIS_LABELS[project.basis] || '-') : '-',
      accountTypeLabel: project ? (ACCOUNT_TYPE_LABELS[project.accountType] || '-') : readable(record.candidate.accountLabel),
      fundInputModeLabel: project ? (PROJECT_FUND_INPUT_MODE_LABELS[project.fundInputMode || 'BANK_UPLOAD'] || '-') : '-',
    },
    budget: {
      contractAmountLabel: project ? formatStoredProjectAmount(project.contractAmount, true) : '-',
      salesVatAmountLabel: project ? formatStoredProjectAmount(project.salesVatAmount, project.salesVatAmount != null) : '-',
      paymentPlanDesc: project ? readable(project.paymentPlanDesc) : '-',
    },
    people: {
      teamName: readable(project?.teamName || record.cic),
      members: project
        ? normalizeProjectTeamMembers(project.teamMembersDetailed).map(formatProjectTeamMemberLine)
        : (candidateMembers.length ? candidateMembers : ['등록 인력 정보 없음']),
    },
    notes: {
      projectPurpose: readable(project?.projectPurpose),
      participantCondition: readable(project?.participantCondition),
    },
  };
}
