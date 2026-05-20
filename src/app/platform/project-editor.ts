import type {
  AccountType,
  Basis,
  FileAttachment,
  Project,
  ProjectExecutiveReviewHistoryEntry,
  ProjectFinancialInputFlags,
  ProjectFundInputMode,
  ProjectPhase,
  ProjectRequestContractAnalysis,
  ProjectRequestPayload,
  ProjectStatus,
  ProjectTeamMemberAssignment,
  ProjectType,
  SettlementSheetPolicy,
  SettlementType,
} from '../data/types';
import {
  createSettlementSheetPolicy,
  normalizeAccountType,
  normalizeBasis,
  normalizeProjectContractType,
  normalizeProjectFundInputMode,
  normalizeProjectPhase,
  normalizeProjectStatus,
  normalizeProjectType,
  normalizeSettlementSheetPolicy,
  normalizeSettlementType,
} from '../data/types';
import {
  createEmptyProjectFinancialInputFlags,
  normalizeProjectFinancialInputFlagsForAmounts,
} from './project-contract-amount';
import { normalizeProjectRevenueFields } from './project-financials';
import {
  formatProjectTeamMembersSummary,
  normalizeProjectTeamMembers,
} from './project-team-members';

export type ProjectEditorMode = 'portal-register' | 'portal-edit' | 'admin';

export interface ProjectEditorDraft {
  name: string;
  officialContractName: string;
  type: ProjectType;
  description: string;
  clientOrg: string;
  department: string;
  projectPurpose: string;
  status: ProjectStatus;
  phase: ProjectPhase;
  contractType: string;
  contractStart: string;
  contractEnd: string;
  contractAmount: number;
  salesVatAmount: number;
  totalRevenueAmount: number;
  supportAmount: number;
  financialInputFlags: ProjectFinancialInputFlags;
  settlementType: SettlementType;
  basis: Basis;
  accountType: AccountType;
  fundInputMode: ProjectFundInputMode;
  settlementSheetPolicy: SettlementSheetPolicy;
  profitRate: number;
  profitAmount: number;
  managerId: string;
  managerName: string;
  teamName: string;
  teamMembersDetailed: ProjectTeamMemberAssignment[];
  participantCondition: string;
  note: string;
  paymentPlanDesc: string;
  settlementGuide: string;
  groupwareName: string;
  paymentPlan: Project['paymentPlan'];
  finalPaymentNote: string;
  budgetCurrentYear: number;
  taxInvoiceAmount: number;
  contractDocument: FileAttachment | null;
  contractAnalysis: ProjectRequestContractAnalysis | null;
}

export interface ProjectEditorPatchOptions {
  baseProject?: Project | null;
  mode: ProjectEditorMode;
  actorId: string;
  actorName: string;
  now: string;
  forceExecutiveReviewPending?: boolean;
  executiveReviewComment?: string | null;
}

const DEFAULT_DRAFT: ProjectEditorDraft = {
  name: '',
  officialContractName: '',
  type: 'D1',
  description: '',
  clientOrg: '',
  department: '',
  projectPurpose: '',
  status: 'CONTRACT_PENDING',
  phase: 'CONFIRMED',
  contractType: '계약서(날인)',
  contractStart: '',
  contractEnd: '',
  contractAmount: 0,
  salesVatAmount: 0,
  totalRevenueAmount: 0,
  supportAmount: 0,
  financialInputFlags: createEmptyProjectFinancialInputFlags(),
  settlementType: 'NONE',
  basis: 'NONE',
  accountType: 'NONE',
  fundInputMode: 'BANK_UPLOAD',
  settlementSheetPolicy: createSettlementSheetPolicy('STANDARD'),
  profitRate: 0,
  profitAmount: 0,
  managerId: '',
  managerName: '',
  teamName: '',
  teamMembersDetailed: [],
  participantCondition: '',
  note: '',
  paymentPlanDesc: '',
  settlementGuide: '',
  groupwareName: '',
  paymentPlan: { contract: 0, interim: 0, final: 0 },
  finalPaymentNote: '',
  budgetCurrentYear: 0,
  taxInvoiceAmount: 0,
  contractDocument: null,
  contractAnalysis: null,
};

function nonNegativeAmount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalizePaymentPlan(value: Project['paymentPlan'] | null | undefined): Project['paymentPlan'] {
  return {
    contract: nonNegativeAmount(value?.contract),
    interim: nonNegativeAmount(value?.interim),
    final: nonNegativeAmount(value?.final),
  };
}

export function createProjectEditorDraft(overrides: Partial<ProjectEditorDraft> = {}): ProjectEditorDraft {
  const draft = {
    ...DEFAULT_DRAFT,
    ...overrides,
    financialInputFlags: normalizeProjectFinancialInputFlagsForAmounts(
      overrides.financialInputFlags ?? DEFAULT_DRAFT.financialInputFlags,
      {
        contractAmount: overrides.contractAmount ?? DEFAULT_DRAFT.contractAmount,
        salesVatAmount: overrides.salesVatAmount ?? DEFAULT_DRAFT.salesVatAmount,
        totalRevenueAmount: overrides.totalRevenueAmount ?? DEFAULT_DRAFT.totalRevenueAmount,
        supportAmount: overrides.supportAmount ?? DEFAULT_DRAFT.supportAmount,
      },
    ),
    type: normalizeProjectType(overrides.type ?? DEFAULT_DRAFT.type),
    status: normalizeProjectStatus(overrides.status ?? DEFAULT_DRAFT.status),
    phase: normalizeProjectPhase(overrides.phase ?? DEFAULT_DRAFT.phase),
    settlementType: normalizeSettlementType(overrides.settlementType ?? DEFAULT_DRAFT.settlementType),
    basis: normalizeBasis(overrides.basis ?? DEFAULT_DRAFT.basis),
    accountType: normalizeAccountType(overrides.accountType ?? DEFAULT_DRAFT.accountType),
    fundInputMode: normalizeProjectFundInputMode(overrides.fundInputMode ?? DEFAULT_DRAFT.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(
      overrides.settlementSheetPolicy ?? DEFAULT_DRAFT.settlementSheetPolicy,
      normalizeProjectFundInputMode(overrides.fundInputMode ?? DEFAULT_DRAFT.fundInputMode),
    ),
    contractType: normalizeProjectContractType(overrides.contractType ?? DEFAULT_DRAFT.contractType),
    paymentPlan: normalizePaymentPlan(overrides.paymentPlan ?? DEFAULT_DRAFT.paymentPlan),
    teamMembersDetailed: normalizeProjectTeamMembers(overrides.teamMembersDetailed),
  };
  return normalizeProjectRevenueFields(draft, 'totalRevenueAmount');
}

export function buildProjectEditorDraftFromProject(
  project: Project,
  payload?: Partial<ProjectRequestPayload> | null,
): ProjectEditorDraft {
  const normalizedProject = normalizeProjectRevenueFields(project, 'totalRevenueAmount');
  const teamMembersDetailed = normalizeProjectTeamMembers(
    normalizedProject.teamMembersDetailed?.length
      ? normalizedProject.teamMembersDetailed
      : payload?.teamMembersDetailed,
  );
  const contractDocument = normalizedProject.contractDocument ?? payload?.contractDocument ?? null;

  return createProjectEditorDraft({
    name: text(normalizedProject.name || payload?.name),
    officialContractName: text(normalizedProject.officialContractName || payload?.officialContractName),
    type: normalizeProjectType(normalizedProject.type || payload?.type),
    description: text(normalizedProject.description || payload?.description),
    clientOrg: text(normalizedProject.clientOrg || payload?.clientOrg),
    department: text(normalizedProject.department || payload?.department),
    projectPurpose: text(normalizedProject.projectPurpose || payload?.projectPurpose),
    status: normalizeProjectStatus(normalizedProject.status),
    phase: normalizeProjectPhase(normalizedProject.phase),
    contractType: normalizeProjectContractType(normalizedProject.contractType || payload?.contractType),
    contractStart: text(normalizedProject.contractStart || payload?.contractStart),
    contractEnd: text(normalizedProject.contractEnd || payload?.contractEnd),
    contractAmount: nonNegativeAmount(normalizedProject.contractAmount ?? payload?.contractAmount),
    salesVatAmount: nonNegativeAmount(normalizedProject.salesVatAmount ?? payload?.salesVatAmount),
    totalRevenueAmount: nonNegativeAmount(normalizedProject.totalRevenueAmount ?? payload?.totalRevenueAmount),
    supportAmount: nonNegativeAmount(normalizedProject.supportAmount ?? payload?.supportAmount),
    financialInputFlags: normalizeProjectFinancialInputFlagsForAmounts(
      normalizedProject.financialInputFlags || payload?.financialInputFlags,
      {
        contractAmount: normalizedProject.contractAmount ?? payload?.contractAmount,
        salesVatAmount: normalizedProject.salesVatAmount ?? payload?.salesVatAmount,
        totalRevenueAmount: normalizedProject.totalRevenueAmount ?? payload?.totalRevenueAmount,
        supportAmount: normalizedProject.supportAmount ?? payload?.supportAmount,
      },
    ),
    settlementType: normalizeSettlementType(normalizedProject.settlementType || payload?.settlementType),
    basis: normalizeBasis(normalizedProject.basis || payload?.basis),
    accountType: normalizeAccountType(normalizedProject.accountType || payload?.accountType),
    fundInputMode: normalizeProjectFundInputMode(normalizedProject.fundInputMode || payload?.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(
      normalizedProject.settlementSheetPolicy || payload?.settlementSheetPolicy,
      normalizeProjectFundInputMode(normalizedProject.fundInputMode || payload?.fundInputMode),
    ),
    profitRate: normalizedProject.profitRate,
    profitAmount: normalizedProject.profitAmount,
    managerId: text(normalizedProject.managerId),
    managerName: text(normalizedProject.managerName || payload?.managerName),
    teamName: text(normalizedProject.teamName || payload?.teamName),
    teamMembersDetailed,
    participantCondition: text(normalizedProject.participantCondition || payload?.participantCondition),
    note: text(payload?.note),
    paymentPlanDesc: text(normalizedProject.paymentPlanDesc || payload?.paymentPlanDesc),
    settlementGuide: text(normalizedProject.settlementGuide || payload?.settlementGuide),
    groupwareName: text(normalizedProject.groupwareName),
    paymentPlan: normalizePaymentPlan(normalizedProject.paymentPlan),
    finalPaymentNote: text(normalizedProject.finalPaymentNote),
    budgetCurrentYear: nonNegativeAmount(normalizedProject.budgetCurrentYear),
    taxInvoiceAmount: nonNegativeAmount(normalizedProject.taxInvoiceAmount),
    contractDocument,
    contractAnalysis: normalizedProject.contractAnalysis ?? payload?.contractAnalysis ?? null,
  });
}

export function buildProjectRequestPayloadFromDraft(draftInput: ProjectEditorDraft): ProjectRequestPayload {
  const draft = createProjectEditorDraft(draftInput);
  const teamMembersDetailed = normalizeProjectTeamMembers(draft.teamMembersDetailed);
  return {
    name: text(draft.name),
    officialContractName: text(draft.officialContractName),
    type: normalizeProjectType(draft.type),
    status: normalizeProjectStatus(draft.status),
    phase: normalizeProjectPhase(draft.phase),
    description: text(draft.description),
    clientOrg: text(draft.clientOrg),
    department: text(draft.department),
    groupwareName: text(draft.groupwareName),
    contractAmount: nonNegativeAmount(draft.contractAmount),
    salesVatAmount: nonNegativeAmount(draft.salesVatAmount),
    totalRevenueAmount: nonNegativeAmount(draft.totalRevenueAmount),
    supportAmount: nonNegativeAmount(draft.supportAmount),
    financialInputFlags: normalizeProjectFinancialInputFlagsForAmounts(draft.financialInputFlags, draft),
    contractStart: text(draft.contractStart),
    contractEnd: text(draft.contractEnd),
    contractType: normalizeProjectContractType(draft.contractType),
    settlementType: normalizeSettlementType(draft.settlementType),
    basis: normalizeBasis(draft.basis),
    accountType: normalizeAccountType(draft.accountType),
    fundInputMode: normalizeProjectFundInputMode(draft.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(draft.settlementSheetPolicy, normalizeProjectFundInputMode(draft.fundInputMode)),
    paymentPlan: normalizePaymentPlan(draft.paymentPlan),
    paymentPlanDesc: text(draft.paymentPlanDesc),
    settlementGuide: text(draft.settlementGuide),
    finalPaymentNote: text(draft.finalPaymentNote),
    projectPurpose: text(draft.projectPurpose),
    managerId: text(draft.managerId),
    managerName: text(draft.managerName),
    teamName: text(draft.teamName),
    teamMembers: formatProjectTeamMembersSummary(teamMembersDetailed, '', ', '),
    teamMembersDetailed,
    participantCondition: text(draft.participantCondition),
    note: text(draft.note),
    contractDocument: draft.contractDocument,
    contractAnalysis: draft.contractAnalysis,
  };
}

function shouldResetApprovedPortalEdit(
  draft: ProjectEditorDraft,
  options: ProjectEditorPatchOptions,
) {
  return options.mode === 'portal-edit'
    && options.baseProject?.registrationSource === 'pm_portal'
    && options.baseProject?.executiveReviewStatus === 'APPROVED'
    && text(draft.name);
}

function appendPendingReviewHistory(
  project: Project,
  options: ProjectEditorPatchOptions,
): ProjectExecutiveReviewHistoryEntry[] {
  const current = Array.isArray(project.executiveReviewHistory) ? project.executiveReviewHistory : [];
  const previousStatus = project.executiveReviewStatus || 'PENDING';
  return [
    ...current,
    {
      status: 'PENDING',
      previousStatus,
      reviewedAt: options.now,
      reviewedById: options.actorId,
      reviewedByName: options.actorName,
      reviewComment: text(options.executiveReviewComment) || undefined,
    },
  ];
}

export function buildProjectEditorProjectPatch(
  draftInput: ProjectEditorDraft,
  options: ProjectEditorPatchOptions,
): Partial<Project> {
  const draft = createProjectEditorDraft(draftInput);
  const flags = normalizeProjectFinancialInputFlagsForAmounts(draft.financialInputFlags, draft);
  const teamMembersDetailed = normalizeProjectTeamMembers(draft.teamMembersDetailed);
  const patch: Partial<Project> = {
    name: text(draft.name),
    officialContractName: text(draft.officialContractName),
    type: normalizeProjectType(draft.type),
    contractAmount: nonNegativeAmount(draft.contractAmount),
    contractStart: text(draft.contractStart),
    contractEnd: text(draft.contractEnd),
    settlementType: normalizeSettlementType(draft.settlementType),
    basis: normalizeBasis(draft.basis),
    accountType: normalizeAccountType(draft.accountType),
    fundInputMode: normalizeProjectFundInputMode(draft.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(draft.settlementSheetPolicy, normalizeProjectFundInputMode(draft.fundInputMode)),
    paymentPlan: normalizePaymentPlan(draft.paymentPlan),
    paymentPlanDesc: text(draft.paymentPlanDesc),
    clientOrg: text(draft.clientOrg),
    groupwareName: text(draft.groupwareName),
    participantCondition: text(draft.participantCondition),
    teamMembersDetailed,
    contractType: normalizeProjectContractType(draft.contractType),
    projectPurpose: text(draft.projectPurpose),
    totalRevenueAmount: nonNegativeAmount(draft.totalRevenueAmount),
    supportAmount: nonNegativeAmount(draft.supportAmount),
    salesVatAmount: nonNegativeAmount(draft.salesVatAmount),
    financialInputFlags: flags,
    settlementGuide: text(draft.settlementGuide),
    contractDocument: draft.contractDocument,
    contractAnalysis: draft.contractAnalysis,
    department: text(draft.department),
    teamName: text(draft.teamName),
    managerId: text(draft.managerId),
    managerName: text(draft.managerName),
    budgetCurrentYear: nonNegativeAmount(draft.budgetCurrentYear || draft.contractAmount),
    taxInvoiceAmount: nonNegativeAmount(draft.taxInvoiceAmount),
    profitRate: draft.profitRate,
    profitAmount: draft.profitAmount,
    finalPaymentNote: text(draft.finalPaymentNote),
    description: text(draft.description),
    updatedAt: options.now,
  };

  if (options.mode === 'admin') {
    patch.status = normalizeProjectStatus(draft.status);
    patch.phase = normalizeProjectPhase(draft.phase);
  }

  if (options.forceExecutiveReviewPending || shouldResetApprovedPortalEdit(draft, options)) {
    patch.executiveReviewStatus = 'PENDING';
    patch.executiveReviewedAt = options.now;
    patch.executiveReviewedById = options.actorId;
    patch.executiveReviewedByName = options.actorName;
    patch.executiveReviewComment = text(options.executiveReviewComment) || null;
    if (options.baseProject) {
      patch.executiveReviewHistory = appendPendingReviewHistory(options.baseProject, options);
    }
  }

  return normalizeProjectRevenueFields(patch, 'totalRevenueAmount');
}
