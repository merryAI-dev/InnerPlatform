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
  project: Project,
): MigrationReviewDossier {
  return {
    headerTitle: readable(project.name || record.sourceName),
    identity: {
      clientOrg: readable(project.clientOrg || record.sourceClientOrg),
      cic: readable(project.cic || project.department || record.cic),
      pmName: readable(project.managerName || record.candidate.coreMembers),
      department: readable(project.department || record.sourceDepartment),
      officialContractName: readable(project.officialContractName || project.name),
    },
    contract: {
      projectTypeLabel: PROJECT_TYPE_LABELS[project.type] || readable(project.type),
      periodLabel: `${readable(project.contractStart)} ~ ${readable(project.contractEnd)}`,
      settlementTypeLabel: SETTLEMENT_TYPE_LABELS[project.settlementType] || '-',
      basisLabel: BASIS_LABELS[project.basis] || '-',
      accountTypeLabel: ACCOUNT_TYPE_LABELS[project.accountType] || '-',
      fundInputModeLabel: PROJECT_FUND_INPUT_MODE_LABELS[project.fundInputMode || 'BANK_UPLOAD'] || '-',
    },
    budget: {
      contractAmountLabel: formatStoredProjectAmount(project.contractAmount, true),
      salesVatAmountLabel: formatStoredProjectAmount(project.salesVatAmount, project.salesVatAmount != null),
      paymentPlanDesc: readable(project.paymentPlanDesc),
    },
    people: {
      teamName: readable(project.teamName),
      members: normalizeProjectTeamMembers(project.teamMembersDetailed).map(formatProjectTeamMemberLine),
    },
    notes: {
      projectPurpose: readable(project.projectPurpose),
      participantCondition: readable(project.participantCondition),
    },
  };
}
