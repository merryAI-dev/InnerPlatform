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
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
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
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
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

function formatAmountForChange(value: unknown) {
  const amount = nonNegativeAmount(value);
  return amount > 0 ? `${amount.toLocaleString('ko-KR')}원` : '-';
}

function formatDateRangeForChange(start: unknown, end: unknown) {
  const startText = text(start);
  const endText = text(end);
  return startText || endText ? `${startText || '-'} ~ ${endText || '-'}` : '-';
}

function formatPaymentPlanForChange(value: Project['paymentPlan'] | null | undefined) {
  const plan = normalizePaymentPlan(value);
  const entries = [
    ['선금/계약금', plan.contract],
    ['중도금', plan.interim],
    ['잔금', plan.final],
  ] as const;
  const label = entries
    .map(([name, amount]) => `${name} ${amount.toLocaleString('ko-KR')}원`)
    .join(' · ');
  return label || '-';
}

function formatTeamMembersForChange(value: ProjectTeamMemberAssignment[] | null | undefined) {
  return formatProjectTeamMembersSummary(normalizeProjectTeamMembers(value), '-', ', ');
}

function normalizeChangeValue(value: unknown) {
  const normalized = text(value);
  return normalized || '-';
}

const REVIEW_CHANGE_FIELDS: Array<{
  key: string;
  label: string;
  before: (project: Project) => string;
  after: (draft: ProjectEditorDraft) => string;
}> = [
  { key: 'name', label: '프로젝트명', before: (project) => normalizeChangeValue(project.name), after: (draft) => normalizeChangeValue(draft.name) },
  { key: 'officialContractName', label: '공식 계약명', before: (project) => normalizeChangeValue(project.officialContractName), after: (draft) => normalizeChangeValue(draft.officialContractName) },
  { key: 'clientOrg', label: '계약 대상', before: (project) => normalizeChangeValue(project.clientOrg), after: (draft) => normalizeChangeValue(draft.clientOrg) },
  { key: 'department', label: '담당조직(CIC)', before: (project) => normalizeChangeValue(project.department), after: (draft) => normalizeChangeValue(draft.department) },
  { key: 'type', label: '프로젝트 유형', before: (project) => PROJECT_TYPE_LABELS[normalizeProjectType(project.type)] || '-', after: (draft) => PROJECT_TYPE_LABELS[normalizeProjectType(draft.type)] || '-' },
  { key: 'contractPeriod', label: '계약 기간', before: (project) => formatDateRangeForChange(project.contractStart, project.contractEnd), after: (draft) => formatDateRangeForChange(draft.contractStart, draft.contractEnd) },
  { key: 'contractAmount', label: '계약금액', before: (project) => formatAmountForChange(project.contractAmount), after: (draft) => formatAmountForChange(draft.contractAmount) },
  { key: 'totalRevenueAmount', label: '총수익', before: (project) => formatAmountForChange(project.totalRevenueAmount), after: (draft) => formatAmountForChange(draft.totalRevenueAmount) },
  { key: 'supportAmount', label: '지원금', before: (project) => formatAmountForChange(project.supportAmount), after: (draft) => formatAmountForChange(draft.supportAmount) },
  { key: 'settlementType', label: '정산 유형', before: (project) => SETTLEMENT_TYPE_LABELS[normalizeSettlementType(project.settlementType)] || '-', after: (draft) => SETTLEMENT_TYPE_LABELS[normalizeSettlementType(draft.settlementType)] || '-' },
  { key: 'basis', label: '정산 기준', before: (project) => BASIS_LABELS[normalizeBasis(project.basis)] || '-', after: (draft) => BASIS_LABELS[normalizeBasis(draft.basis)] || '-' },
  { key: 'accountType', label: '통장 유형', before: (project) => ACCOUNT_TYPE_LABELS[normalizeAccountType(project.accountType)] || '-', after: (draft) => ACCOUNT_TYPE_LABELS[normalizeAccountType(draft.accountType)] || '-' },
  { key: 'fundInputMode', label: '자금 입력 방식', before: (project) => PROJECT_FUND_INPUT_MODE_LABELS[normalizeProjectFundInputMode(project.fundInputMode)] || '-', after: (draft) => PROJECT_FUND_INPUT_MODE_LABELS[normalizeProjectFundInputMode(draft.fundInputMode)] || '-' },
  { key: 'managerName', label: 'PM', before: (project) => normalizeChangeValue(project.managerName), after: (draft) => normalizeChangeValue(draft.managerName) },
  { key: 'teamName', label: '사내기업팀', before: (project) => normalizeChangeValue(project.teamName), after: (draft) => normalizeChangeValue(draft.teamName) },
  { key: 'teamMembersDetailed', label: '팀원', before: (project) => formatTeamMembersForChange(project.teamMembersDetailed), after: (draft) => formatTeamMembersForChange(draft.teamMembersDetailed) },
  { key: 'paymentPlan', label: '입금 분할', before: (project) => formatPaymentPlanForChange(project.paymentPlan), after: (draft) => formatPaymentPlanForChange(draft.paymentPlan) },
  { key: 'paymentPlanDesc', label: '입금 계획', before: (project) => normalizeChangeValue(project.paymentPlanDesc), after: (draft) => normalizeChangeValue(draft.paymentPlanDesc) },
  { key: 'finalPaymentNote', label: '최종 입금 메모', before: (project) => normalizeChangeValue(project.finalPaymentNote), after: (draft) => normalizeChangeValue(draft.finalPaymentNote) },
  { key: 'projectPurpose', label: '프로젝트 목적', before: (project) => normalizeChangeValue(project.projectPurpose), after: (draft) => normalizeChangeValue(draft.projectPurpose) },
  { key: 'description', label: '주요 내용', before: (project) => normalizeChangeValue(project.description), after: (draft) => normalizeChangeValue(draft.description) },
  { key: 'contractDocument', label: '계약서 PDF', before: (project) => normalizeChangeValue(project.contractDocument?.name), after: (draft) => normalizeChangeValue(draft.contractDocument?.name) },
];

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
    Array.isArray(normalizedProject.teamMembersDetailed)
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

export function buildProjectEditorReviewChanges(
  project: Project,
  draftInput: ProjectEditorDraft,
): ProjectExecutiveReviewHistoryEntry['changes'] {
  const draft = createProjectEditorDraft(draftInput);
  return REVIEW_CHANGE_FIELDS
    .map((field) => ({
      key: field.key,
      label: field.label,
      before: normalizeChangeValue(field.before(project)),
      after: normalizeChangeValue(field.after(draft)),
    }))
    .filter((change) => change.before !== change.after);
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
  draft: ProjectEditorDraft,
  options: ProjectEditorPatchOptions,
  changes = buildProjectEditorReviewChanges(project, draft),
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
      ...(changes && changes.length > 0 ? { changes } : {}),
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
  const reviewChanges = options.baseProject
    ? buildProjectEditorReviewChanges(options.baseProject, draft)
    : [];
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

  if (
    options.forceExecutiveReviewPending
    || shouldResetApprovedPortalEdit(draft, options)
    || (
      options.mode === 'portal-edit'
      && options.baseProject?.registrationSource === 'pm_portal'
      && options.baseProject?.executiveReviewStatus === 'PENDING'
      && reviewChanges.length > 0
    )
  ) {
    patch.executiveReviewStatus = 'PENDING';
    patch.executiveReviewedAt = options.now;
    patch.executiveReviewedById = options.actorId;
    patch.executiveReviewedByName = options.actorName;
    patch.executiveReviewComment = text(options.executiveReviewComment) || null;
    if (options.baseProject) {
      patch.executiveReviewHistory = appendPendingReviewHistory(options.baseProject, draft, options, reviewChanges);
    }
  }

  return normalizeProjectRevenueFields(patch, 'totalRevenueAmount');
}
