import type {
  AccountType,
  Basis,
  FileAttachment,
  Project,
  ProjectExecutiveReviewHistoryEntry,
  ProjectCurrency,
  ProjectFinancialInputFlags,
  ProjectFundInputMode,
  ProjectFinancialYear,
  ProjectPaymentExpectedMonths,
  ProjectLaborTransferPlan,
  ProjectRegistrationConfirmations,
  ProjectRegistrationOptionalDocumentNotes,
  ProjectCheckout,
  ProjectPhase,
  ProjectRequestContractAnalysis,
  ProjectRequestPayload,
  ProjectStatus,
  ProjectTeamMemberAssignment,
  ProjectType,
  LaborSettlementBasis,
  SettlementSystemCode,
  SettlementSheetPolicy,
  SettlementType,
} from '../data/types';
import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  createSettlementSheetPolicy,
  LABOR_SETTLEMENT_BASIS_LABELS,
  normalizeAccountType,
  normalizeBasis,
  normalizeProjectCurrency,
  normalizeProjectContractType,
  normalizeProjectFundInputMode,
  normalizeLaborSettlementBasis,
  normalizeProjectPhase,
  normalizeProjectStatus,
  normalizeProjectType,
  normalizeSettlementSheetPolicy,
  normalizeSettlementSystemCode,
  normalizeSettlementType,
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_CURRENCY_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_SYSTEM_LABELS,
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
import { normalizeProjectDepartment, resolveProjectCic } from './project-cic';

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
  currency: ProjectCurrency;
  contractAmount: number;
  salesVatAmount: number;
  totalRevenueAmount: number;
  supportAmount: number;
  financialInputFlags: ProjectFinancialInputFlags;
  registrationRequirementsVersion: 1 | 2;
  financialYears: ProjectFinancialYear[];
  registrationConfirmations: ProjectRegistrationConfirmations;
  registrationOptionalDocumentNotes: ProjectRegistrationOptionalDocumentNotes;
  checkout: ProjectCheckout;
  settlementType: SettlementType;
  basis: Basis;
  accountType: AccountType;
  settlementSystem: SettlementSystemCode;
  laborSettlementBasis: LaborSettlementBasis;
  fundInputMode: ProjectFundInputMode;
  settlementSheetPolicy: SettlementSheetPolicy;
  profitRate: number;
  profitAmount: number;
  registeredById: string;
  registeredByName: string;
  registeredByEmail: string;
  executiveApproverId: string;
  executiveApproverName: string;
  executiveApproverEmail: string;
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
  paymentExpectedMonths: ProjectPaymentExpectedMonths;
  laborTransferPlan: ProjectLaborTransferPlan;
  advanceInterimBelow70Reason: string;
  finalPaymentNote: string;
  budgetCurrentYear: number;
  taxInvoiceAmount: number;
  contractDocument: FileAttachment | null;
  quoteDocument: FileAttachment | null;
  proposalDocument: FileAttachment | null;
  proposalWordOriginalDocument: FileAttachment | null;
  proposalPptOriginalDocument: FileAttachment | null;
  presentationPptOriginalDocument: FileAttachment | null;
  rfpRequestEvidenceDocument: FileAttachment | null;
  customerBusinessRegistrationDocument: FileAttachment | null;
  performanceCertificateDocument: FileAttachment | null;
  taxInvoiceDocument: FileAttachment | null;
  finalSettlementReportDocument: FileAttachment | null;
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
  currency: 'KRW',
  contractAmount: 0,
  salesVatAmount: 0,
  totalRevenueAmount: 0,
  supportAmount: 0,
  financialInputFlags: createEmptyProjectFinancialInputFlags(),
  registrationRequirementsVersion: 1,
  financialYears: [],
  registrationConfirmations: {
    laborIncludesFourInsurance: null,
    laborIncludesRetirementPay: null,
    customerSettlementBasisConfirmed: false,
    modusignContractUsed: null,
    originalContractSubmitted: null,
  },
  registrationOptionalDocumentNotes: {
    proposalWordOriginal: '',
    proposalPptOriginal: '',
    presentationPptOriginal: '',
  },
  checkout: {
    finalPaymentReceived: false,
    bankBalanceZero: false,
    performanceCertificateReceived: false,
    taxInvoiceEvidenceConfirmed: false,
    finalSettlementReportConfirmed: false,
    usbEvidenceSubmitted: false,
    evidenceDeletedAfterUsb: false,
  },
  settlementType: 'NONE',
  basis: 'NONE',
  accountType: 'NONE',
  settlementSystem: 'NONE',
  laborSettlementBasis: 'NONE',
  fundInputMode: 'BANK_UPLOAD',
  settlementSheetPolicy: createSettlementSheetPolicy('STANDARD'),
  profitRate: 0,
  profitAmount: 0,
  registeredById: '',
  registeredByName: '',
  registeredByEmail: '',
  executiveApproverId: '',
  executiveApproverName: '',
  executiveApproverEmail: '',
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
  paymentExpectedMonths: { contract: '', interim: '', final: '' },
  laborTransferPlan: { mode: 'MONTHLY_WEEK_3', milestoneAmounts: { contract: 0, interim: 0, final: 0 } },
  advanceInterimBelow70Reason: '',
  finalPaymentNote: '',
  budgetCurrentYear: 0,
  taxInvoiceAmount: 0,
  contractDocument: null,
  quoteDocument: null,
  proposalDocument: null,
  proposalWordOriginalDocument: null,
  proposalPptOriginalDocument: null,
  presentationPptOriginalDocument: null,
  rfpRequestEvidenceDocument: null,
  customerBusinessRegistrationDocument: null,
  performanceCertificateDocument: null,
  taxInvoiceDocument: null,
  finalSettlementReportDocument: null,
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

function registrationRequirementsVersion(value: unknown): 1 | 2 {
  return value === 2 ? 2 : 1;
}

function dateYear(value: unknown): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(text(value));
  return match ? Number(match[1]) : null;
}

function projectFinancialYears(
  value: unknown,
  contractStart: unknown,
  contractEnd: unknown,
  totals: Pick<ProjectEditorDraft, 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'supportAmount' | 'profitRate'>,
  version: 1 | 2,
): ProjectFinancialYear[] {
  const rows = Array.isArray(value) ? value : [];
  const normalized = new Map<number, ProjectFinancialYear>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const source = row as Partial<ProjectFinancialYear>;
    const year = Number(source.year);
    if (!Number.isSafeInteger(year) || year < 2000 || year > 2099 || normalized.has(year)) continue;
    normalized.set(year, {
      year,
      contractAmount: nonNegativeAmount(source.contractAmount),
      salesVatAmount: nonNegativeAmount(source.salesVatAmount),
      totalRevenueAmount: nonNegativeAmount(source.totalRevenueAmount),
      supportAmount: nonNegativeAmount(source.supportAmount),
      profitRate: Math.min(1, Math.max(0, Number(source.profitRate) || 0)),
      confirmed: source.confirmed === true,
    });
  }
  if (version !== 2) return [...normalized.values()].sort((a, b) => a.year - b.year);
  const startYear = dateYear(contractStart);
  const endYear = dateYear(contractEnd);
  if (!startYear || !endYear || startYear > endYear || endYear - startYear > 20) return [];
  return Array.from({ length: endYear - startYear + 1 }, (_, offset) => {
    const year = startYear + offset;
    return normalized.get(year) || {
      year,
      contractAmount: offset === 0 ? nonNegativeAmount(totals.contractAmount) : 0,
      salesVatAmount: offset === 0 ? nonNegativeAmount(totals.salesVatAmount) : 0,
      totalRevenueAmount: offset === 0 ? nonNegativeAmount(totals.totalRevenueAmount) : 0,
      supportAmount: offset === 0 ? nonNegativeAmount(totals.supportAmount) : 0,
      profitRate: offset === 0 ? Math.min(1, Math.max(0, Number(totals.profitRate) || 0)) : 0,
      confirmed: false,
    };
  });
}

function registrationConfirmations(value: unknown): ProjectRegistrationConfirmations {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ProjectRegistrationConfirmations>
    : {};
  const optionalBoolean = (input: unknown) => typeof input === 'boolean' ? input : null;
  return {
    laborIncludesFourInsurance: optionalBoolean(source.laborIncludesFourInsurance),
    laborIncludesRetirementPay: optionalBoolean(source.laborIncludesRetirementPay),
    customerSettlementBasisConfirmed: source.customerSettlementBasisConfirmed === true,
    modusignContractUsed: optionalBoolean(source.modusignContractUsed),
    originalContractSubmitted: optionalBoolean(source.originalContractSubmitted),
  };
}

function registrationOptionalDocumentNotes(value: unknown): ProjectRegistrationOptionalDocumentNotes {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ProjectRegistrationOptionalDocumentNotes>
    : {};
  return {
    proposalWordOriginal: text(source.proposalWordOriginal),
    proposalPptOriginal: text(source.proposalPptOriginal),
    presentationPptOriginal: text(source.presentationPptOriginal),
  };
}

function projectCheckout(value: unknown): ProjectCheckout {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ProjectCheckout>
    : {};
  return {
    finalPaymentReceived: source.finalPaymentReceived === true,
    bankBalanceZero: source.bankBalanceZero === true,
    performanceCertificateReceived: source.performanceCertificateReceived === true,
    taxInvoiceEvidenceConfirmed: source.taxInvoiceEvidenceConfirmed === true,
    finalSettlementReportConfirmed: source.finalSettlementReportConfirmed === true,
    usbEvidenceSubmitted: source.usbEvidenceSubmitted === true,
    evidenceDeletedAfterUsb: source.evidenceDeletedAfterUsb === true,
  };
}

function normalizePaymentPlan(value: Project['paymentPlan'] | null | undefined): Project['paymentPlan'] {
  return {
    contract: nonNegativeAmount(value?.contract),
    interim: nonNegativeAmount(value?.interim),
    final: nonNegativeAmount(value?.final),
  };
}

function normalizeExpectedMonth(value: unknown): string {
  const normalized = text(value);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : '';
}

function normalizePaymentExpectedMonths(
  value: Partial<ProjectPaymentExpectedMonths> | null | undefined,
): ProjectPaymentExpectedMonths {
  return {
    contract: normalizeExpectedMonth(value?.contract),
    interim: normalizeExpectedMonth(value?.interim),
    final: normalizeExpectedMonth(value?.final),
  };
}

function normalizeLaborTransferPlan(_value: Partial<ProjectLaborTransferPlan> | null | undefined): ProjectLaborTransferPlan {
  return {
    mode: 'MONTHLY_WEEK_3',
    milestoneAmounts: { contract: 0, interim: 0, final: 0 },
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

function formatPaymentExpectedMonthsForChange(value: Partial<ProjectPaymentExpectedMonths> | null | undefined) {
  const months = normalizePaymentExpectedMonths(value);
  return [
    months.contract ? `선금 ${months.contract}` : '',
    months.interim ? `중도금 ${months.interim}` : '',
    months.final ? `잔금 ${months.final}` : '',
  ].filter(Boolean).join(' · ') || '-';
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
  { key: 'currency', label: '통화', before: (project) => PROJECT_CURRENCY_LABELS[normalizeProjectCurrency(project.currency)] || '-', after: (draft) => PROJECT_CURRENCY_LABELS[normalizeProjectCurrency(draft.currency)] || '-' },
  { key: 'contractAmount', label: '계약금액', before: (project) => formatAmountForChange(project.contractAmount), after: (draft) => formatAmountForChange(draft.contractAmount) },
  { key: 'totalRevenueAmount', label: '총수익', before: (project) => formatAmountForChange(project.totalRevenueAmount), after: (draft) => formatAmountForChange(draft.totalRevenueAmount) },
  { key: 'supportAmount', label: '지원금', before: (project) => formatAmountForChange(project.supportAmount), after: (draft) => formatAmountForChange(draft.supportAmount) },
  { key: 'settlementType', label: '정산 유형', before: (project) => SETTLEMENT_TYPE_LABELS[normalizeSettlementType(project.settlementType)] || '-', after: (draft) => SETTLEMENT_TYPE_LABELS[normalizeSettlementType(draft.settlementType)] || '-' },
  { key: 'basis', label: '정산 기준', before: (project) => BASIS_LABELS[normalizeBasis(project.basis)] || '-', after: (draft) => BASIS_LABELS[normalizeBasis(draft.basis)] || '-' },
  { key: 'accountType', label: '통장 유형', before: (project) => ACCOUNT_TYPE_LABELS[normalizeAccountType(project.accountType)] || '-', after: (draft) => ACCOUNT_TYPE_LABELS[normalizeAccountType(draft.accountType)] || '-' },
  { key: 'settlementSystem', label: '정산 시스템', before: (project) => SETTLEMENT_SYSTEM_LABELS[normalizeSettlementSystemCode(project.settlementSystem)] || '-', after: (draft) => SETTLEMENT_SYSTEM_LABELS[normalizeSettlementSystemCode(draft.settlementSystem)] || '-' },
  { key: 'laborSettlementBasis', label: '인건비 정산 기준', before: (project) => LABOR_SETTLEMENT_BASIS_LABELS[normalizeLaborSettlementBasis(project.laborSettlementBasis)] || '-', after: (draft) => LABOR_SETTLEMENT_BASIS_LABELS[normalizeLaborSettlementBasis(draft.laborSettlementBasis)] || '-' },
  { key: 'fundInputMode', label: '자금 입력 방식', before: (project) => PROJECT_FUND_INPUT_MODE_LABELS[normalizeProjectFundInputMode(project.fundInputMode)] || '-', after: (draft) => PROJECT_FUND_INPUT_MODE_LABELS[normalizeProjectFundInputMode(draft.fundInputMode)] || '-' },
  { key: 'registeredByName', label: '사업 담당자', before: (project) => normalizeChangeValue(project.registeredByName || project.managerName), after: (draft) => normalizeChangeValue(draft.registeredByName || draft.managerName) },
  { key: 'executiveApproverName', label: '지정 결재자', before: (project) => normalizeChangeValue(project.executiveApproverName), after: (draft) => normalizeChangeValue(draft.executiveApproverName) },
  { key: 'teamName', label: '사내기업팀', before: (project) => normalizeChangeValue(project.teamName), after: (draft) => normalizeChangeValue(draft.teamName) },
  { key: 'teamMembersDetailed', label: '서류상 참여인력', before: (project) => formatTeamMembersForChange(project.teamMembersDetailed), after: (draft) => formatTeamMembersForChange(draft.teamMembersDetailed) },
  { key: 'paymentPlan', label: '입금 분할', before: (project) => formatPaymentPlanForChange(project.paymentPlan), after: (draft) => formatPaymentPlanForChange(draft.paymentPlan) },
  { key: 'paymentExpectedMonths', label: '입금 예상월', before: (project) => formatPaymentExpectedMonthsForChange(project.paymentExpectedMonths), after: (draft) => formatPaymentExpectedMonthsForChange(draft.paymentExpectedMonths) },
  { key: 'advanceInterimBelow70Reason', label: '선금·중도금 70% 미만 사유', before: (project) => normalizeChangeValue(project.advanceInterimBelow70Reason), after: (draft) => normalizeChangeValue(draft.advanceInterimBelow70Reason) },
  { key: 'paymentPlanDesc', label: '입금 계획', before: (project) => normalizeChangeValue(project.paymentPlanDesc), after: (draft) => normalizeChangeValue(draft.paymentPlanDesc) },
  { key: 'finalPaymentNote', label: '최종 입금 메모', before: (project) => normalizeChangeValue(project.finalPaymentNote), after: (draft) => normalizeChangeValue(draft.finalPaymentNote) },
  { key: 'projectPurpose', label: '프로젝트 목적', before: (project) => normalizeChangeValue(project.projectPurpose), after: (draft) => normalizeChangeValue(draft.projectPurpose) },
  { key: 'description', label: '주요 내용', before: (project) => normalizeChangeValue(project.description), after: (draft) => normalizeChangeValue(draft.description) },
  { key: 'note', label: '비고', before: (project) => normalizeChangeValue(project.note), after: (draft) => normalizeChangeValue(draft.note) },
  { key: 'contractDocument', label: '계약서 PDF', before: (project) => normalizeChangeValue(project.contractDocument?.name), after: (draft) => normalizeChangeValue(draft.contractDocument?.name) },
  { key: 'quoteDocument', label: '견적서 PDF', before: (project) => normalizeChangeValue(project.quoteDocument?.name), after: (draft) => normalizeChangeValue(draft.quoteDocument?.name) },
  { key: 'proposalDocument', label: '제안서 PDF', before: (project) => normalizeChangeValue(project.proposalDocument?.name), after: (draft) => normalizeChangeValue(draft.proposalDocument?.name) },
  { key: 'proposalWordOriginalDocument', label: '제안서 Word 원본', before: (project) => normalizeChangeValue(project.proposalWordOriginalDocument?.name), after: (draft) => normalizeChangeValue(draft.proposalWordOriginalDocument?.name) },
  { key: 'proposalPptOriginalDocument', label: '제안서 PPT 원본', before: (project) => normalizeChangeValue(project.proposalPptOriginalDocument?.name), after: (draft) => normalizeChangeValue(draft.proposalPptOriginalDocument?.name) },
  { key: 'presentationPptOriginalDocument', label: '발표자료 PPT 원본', before: (project) => normalizeChangeValue(project.presentationPptOriginalDocument?.name), after: (draft) => normalizeChangeValue(draft.presentationPptOriginalDocument?.name) },
  { key: 'rfpRequestEvidenceDocument', label: 'RFP 또는 요청 메일 증빙', before: (project) => normalizeChangeValue(project.rfpRequestEvidenceDocument?.name), after: (draft) => normalizeChangeValue(draft.rfpRequestEvidenceDocument?.name) },
  { key: 'customerBusinessRegistrationDocument', label: '발주처 사업자등록증 PDF', before: (project) => normalizeChangeValue(project.customerBusinessRegistrationDocument?.name), after: (draft) => normalizeChangeValue(draft.customerBusinessRegistrationDocument?.name) },
  { key: 'performanceCertificateDocument', label: '수행확인서 PDF', before: (project) => normalizeChangeValue(project.performanceCertificateDocument?.name), after: (draft) => normalizeChangeValue(draft.performanceCertificateDocument?.name) },
  { key: 'taxInvoiceDocument', label: '세금계산서 PDF', before: (project) => normalizeChangeValue(project.taxInvoiceDocument?.name), after: (draft) => normalizeChangeValue(draft.taxInvoiceDocument?.name) },
  { key: 'finalSettlementReportDocument', label: '최종 정산보고서 PDF', before: (project) => normalizeChangeValue(project.finalSettlementReportDocument?.name), after: (draft) => normalizeChangeValue(draft.finalSettlementReportDocument?.name) },
];

export function createProjectEditorDraft(overrides: Partial<ProjectEditorDraft> = {}): ProjectEditorDraft {
  const version = registrationRequirementsVersion(overrides.registrationRequirementsVersion);
  const totals = {
    contractAmount: nonNegativeAmount(overrides.contractAmount ?? DEFAULT_DRAFT.contractAmount),
    salesVatAmount: nonNegativeAmount(overrides.salesVatAmount ?? DEFAULT_DRAFT.salesVatAmount),
    totalRevenueAmount: nonNegativeAmount(overrides.totalRevenueAmount ?? DEFAULT_DRAFT.totalRevenueAmount),
    supportAmount: nonNegativeAmount(overrides.supportAmount ?? DEFAULT_DRAFT.supportAmount),
    profitRate: Math.min(1, Math.max(0, Number(overrides.profitRate ?? DEFAULT_DRAFT.profitRate) || 0)),
  };
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
    settlementSystem: normalizeSettlementSystemCode(overrides.settlementSystem ?? DEFAULT_DRAFT.settlementSystem),
    laborSettlementBasis: normalizeLaborSettlementBasis(
      overrides.laborSettlementBasis ?? DEFAULT_DRAFT.laborSettlementBasis,
    ),
    fundInputMode: normalizeProjectFundInputMode(overrides.fundInputMode ?? DEFAULT_DRAFT.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(
      overrides.settlementSheetPolicy ?? DEFAULT_DRAFT.settlementSheetPolicy,
      normalizeProjectFundInputMode(overrides.fundInputMode ?? DEFAULT_DRAFT.fundInputMode),
    ),
    contractType: normalizeProjectContractType(overrides.contractType ?? DEFAULT_DRAFT.contractType),
    currency: normalizeProjectCurrency(overrides.currency ?? DEFAULT_DRAFT.currency),
    registeredById: text(overrides.registeredById ?? overrides.managerId ?? DEFAULT_DRAFT.registeredById),
    registeredByName: text(overrides.registeredByName ?? overrides.managerName ?? DEFAULT_DRAFT.registeredByName),
    registeredByEmail: text(overrides.registeredByEmail ?? DEFAULT_DRAFT.registeredByEmail),
    executiveApproverId: text(overrides.executiveApproverId ?? DEFAULT_DRAFT.executiveApproverId),
    executiveApproverName: text(overrides.executiveApproverName ?? DEFAULT_DRAFT.executiveApproverName),
    executiveApproverEmail: text(overrides.executiveApproverEmail ?? DEFAULT_DRAFT.executiveApproverEmail),
    managerId: text(overrides.registeredById ?? overrides.managerId ?? DEFAULT_DRAFT.managerId),
    managerName: text(overrides.registeredByName ?? overrides.managerName ?? DEFAULT_DRAFT.managerName),
    paymentPlan: normalizePaymentPlan(overrides.paymentPlan ?? DEFAULT_DRAFT.paymentPlan),
    paymentExpectedMonths: normalizePaymentExpectedMonths(
      overrides.paymentExpectedMonths ?? DEFAULT_DRAFT.paymentExpectedMonths,
    ),
    laborTransferPlan: normalizeLaborTransferPlan(
      overrides.laborTransferPlan ?? DEFAULT_DRAFT.laborTransferPlan,
    ),
    teamMembersDetailed: normalizeProjectTeamMembers(overrides.teamMembersDetailed),
    registrationRequirementsVersion: version,
    financialYears: projectFinancialYears(
      overrides.financialYears,
      overrides.contractStart ?? DEFAULT_DRAFT.contractStart,
      overrides.contractEnd ?? DEFAULT_DRAFT.contractEnd,
      totals,
      version,
    ),
    registrationConfirmations: registrationConfirmations(overrides.registrationConfirmations),
    registrationOptionalDocumentNotes: registrationOptionalDocumentNotes(overrides.registrationOptionalDocumentNotes),
    checkout: projectCheckout(overrides.checkout),
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
  const quoteDocument = normalizedProject.quoteDocument ?? payload?.quoteDocument ?? null;
  const proposalDocument = normalizedProject.proposalDocument ?? payload?.proposalDocument ?? null;
  const proposalWordOriginalDocument = normalizedProject.proposalWordOriginalDocument
    ?? payload?.proposalWordOriginalDocument
    ?? null;
  const proposalPptOriginalDocument = normalizedProject.proposalPptOriginalDocument
    ?? payload?.proposalPptOriginalDocument
    ?? null;
  const presentationPptOriginalDocument = normalizedProject.presentationPptOriginalDocument
    ?? payload?.presentationPptOriginalDocument
    ?? null;
  const rfpRequestEvidenceDocument = normalizedProject.rfpRequestEvidenceDocument
    ?? payload?.rfpRequestEvidenceDocument
    ?? null;
  const customerBusinessRegistrationDocument = normalizedProject.customerBusinessRegistrationDocument
    ?? payload?.customerBusinessRegistrationDocument
    ?? null;
  const performanceCertificateDocument = normalizedProject.performanceCertificateDocument
    ?? payload?.performanceCertificateDocument
    ?? null;
  const taxInvoiceDocument = normalizedProject.taxInvoiceDocument ?? payload?.taxInvoiceDocument ?? null;
  const finalSettlementReportDocument = normalizedProject.finalSettlementReportDocument
    ?? payload?.finalSettlementReportDocument
    ?? null;

  return createProjectEditorDraft({
    name: text(normalizedProject.name || payload?.name),
    officialContractName: text(normalizedProject.officialContractName || payload?.officialContractName),
    type: normalizeProjectType(normalizedProject.type || payload?.type),
    description: text(normalizedProject.description || payload?.description),
    clientOrg: text(normalizedProject.clientOrg || payload?.clientOrg),
    department: normalizeProjectDepartment(
      normalizedProject.department || normalizedProject.cic || payload?.department,
    ),
    projectPurpose: text(normalizedProject.projectPurpose || payload?.projectPurpose),
    status: normalizeProjectStatus(normalizedProject.status),
    phase: normalizeProjectPhase(normalizedProject.phase),
    contractType: normalizeProjectContractType(normalizedProject.contractType || payload?.contractType),
    contractStart: text(normalizedProject.contractStart || payload?.contractStart),
    contractEnd: text(normalizedProject.contractEnd || payload?.contractEnd),
    currency: normalizeProjectCurrency(normalizedProject.currency || payload?.currency),
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
    registrationRequirementsVersion: registrationRequirementsVersion(
      normalizedProject.registrationRequirementsVersion ?? payload?.registrationRequirementsVersion,
    ),
    financialYears: normalizedProject.financialYears ?? payload?.financialYears,
    registrationConfirmations: normalizedProject.registrationConfirmations ?? payload?.registrationConfirmations,
    registrationOptionalDocumentNotes: normalizedProject.registrationOptionalDocumentNotes
      ?? payload?.registrationOptionalDocumentNotes,
    checkout: normalizedProject.checkout ?? payload?.checkout,
    settlementType: normalizeSettlementType(normalizedProject.settlementType || payload?.settlementType),
    basis: normalizeBasis(normalizedProject.basis || payload?.basis),
    accountType: normalizeAccountType(normalizedProject.accountType || payload?.accountType),
    settlementSystem: normalizeSettlementSystemCode(
      normalizedProject.settlementSystem || payload?.settlementSystem,
    ),
    laborSettlementBasis: normalizeLaborSettlementBasis(
      normalizedProject.laborSettlementBasis || payload?.laborSettlementBasis,
    ),
    fundInputMode: normalizeProjectFundInputMode(normalizedProject.fundInputMode || payload?.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(
      normalizedProject.settlementSheetPolicy || payload?.settlementSheetPolicy,
      normalizeProjectFundInputMode(normalizedProject.fundInputMode || payload?.fundInputMode),
    ),
    profitRate: normalizedProject.profitRate,
    profitAmount: normalizedProject.profitAmount,
    registeredById: text(normalizedProject.registeredById || payload?.registeredById || normalizedProject.managerId || payload?.managerId),
    registeredByName: text(normalizedProject.registeredByName || payload?.registeredByName || normalizedProject.managerName || payload?.managerName),
    registeredByEmail: text(normalizedProject.registeredByEmail || payload?.registeredByEmail),
    executiveApproverId: text(normalizedProject.executiveApproverId || payload?.executiveApproverId),
    executiveApproverName: text(normalizedProject.executiveApproverName || payload?.executiveApproverName),
    executiveApproverEmail: text(normalizedProject.executiveApproverEmail || payload?.executiveApproverEmail),
    managerId: text(normalizedProject.registeredById || payload?.registeredById || normalizedProject.managerId || payload?.managerId),
    managerName: text(normalizedProject.registeredByName || payload?.registeredByName || normalizedProject.managerName || payload?.managerName),
    teamName: text(normalizedProject.teamName || payload?.teamName),
    teamMembersDetailed,
    participantCondition: text(normalizedProject.participantCondition || payload?.participantCondition),
    note: text(normalizedProject.note || payload?.note),
    paymentPlanDesc: text(normalizedProject.paymentPlanDesc || payload?.paymentPlanDesc),
    settlementGuide: text(normalizedProject.settlementGuide || payload?.settlementGuide),
    groupwareName: text(normalizedProject.groupwareName || payload?.groupwareName),
    paymentPlan: normalizePaymentPlan(normalizedProject.paymentPlan || payload?.paymentPlan),
    paymentExpectedMonths: normalizePaymentExpectedMonths(
      normalizedProject.paymentExpectedMonths || payload?.paymentExpectedMonths,
    ),
    laborTransferPlan: normalizeLaborTransferPlan(
      normalizedProject.laborTransferPlan || payload?.laborTransferPlan,
    ),
    advanceInterimBelow70Reason: text(
      normalizedProject.advanceInterimBelow70Reason || payload?.advanceInterimBelow70Reason,
    ),
    finalPaymentNote: text(normalizedProject.finalPaymentNote),
    budgetCurrentYear: nonNegativeAmount(normalizedProject.budgetCurrentYear),
    taxInvoiceAmount: nonNegativeAmount(normalizedProject.taxInvoiceAmount),
    contractDocument,
    quoteDocument,
    proposalDocument,
    proposalWordOriginalDocument,
    proposalPptOriginalDocument,
    presentationPptOriginalDocument,
    rfpRequestEvidenceDocument,
    customerBusinessRegistrationDocument,
    performanceCertificateDocument,
    taxInvoiceDocument,
    finalSettlementReportDocument,
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
    department: normalizeProjectDepartment(draft.department),
    groupwareName: text(draft.name),
    currency: normalizeProjectCurrency(draft.currency),
    contractAmount: nonNegativeAmount(draft.contractAmount),
    salesVatAmount: nonNegativeAmount(draft.salesVatAmount),
    totalRevenueAmount: nonNegativeAmount(draft.totalRevenueAmount),
    supportAmount: nonNegativeAmount(draft.supportAmount),
    financialInputFlags: normalizeProjectFinancialInputFlagsForAmounts(draft.financialInputFlags, draft),
    registrationRequirementsVersion: draft.registrationRequirementsVersion,
    financialYears: draft.financialYears,
    registrationConfirmations: draft.registrationConfirmations,
    registrationOptionalDocumentNotes: draft.registrationOptionalDocumentNotes,
    checkout: draft.checkout,
    contractStart: text(draft.contractStart),
    contractEnd: text(draft.contractEnd),
    contractType: normalizeProjectContractType(draft.contractType),
    settlementType: normalizeSettlementType(draft.settlementType),
    basis: normalizeBasis(draft.basis),
    accountType: normalizeAccountType(draft.accountType),
    settlementSystem: normalizeSettlementSystemCode(draft.settlementSystem),
    laborSettlementBasis: normalizeLaborSettlementBasis(draft.laborSettlementBasis),
    fundInputMode: normalizeProjectFundInputMode(draft.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(draft.settlementSheetPolicy, normalizeProjectFundInputMode(draft.fundInputMode)),
    paymentPlan: normalizePaymentPlan(draft.paymentPlan),
    paymentExpectedMonths: normalizePaymentExpectedMonths(draft.paymentExpectedMonths),
    laborTransferPlan: normalizeLaborTransferPlan(draft.laborTransferPlan),
    advanceInterimBelow70Reason: text(draft.advanceInterimBelow70Reason),
    paymentPlanDesc: text(draft.paymentPlanDesc),
    settlementGuide: text(draft.settlementGuide),
    finalPaymentNote: text(draft.finalPaymentNote),
    projectPurpose: text(draft.projectPurpose),
    registeredById: text(draft.registeredById),
    registeredByName: text(draft.registeredByName),
    registeredByEmail: text(draft.registeredByEmail),
    executiveApproverId: text(draft.executiveApproverId),
    executiveApproverName: text(draft.executiveApproverName),
    executiveApproverEmail: text(draft.executiveApproverEmail),
    managerId: text(draft.registeredById),
    managerName: text(draft.registeredByName),
    teamName: text(draft.teamName),
    teamMembers: formatProjectTeamMembersSummary(teamMembersDetailed, '', ', '),
    teamMembersDetailed,
    participantCondition: text(draft.participantCondition),
    note: text(draft.note),
    contractDocument: draft.contractDocument,
    quoteDocument: draft.quoteDocument,
    proposalDocument: draft.proposalDocument,
    proposalWordOriginalDocument: draft.proposalWordOriginalDocument,
    proposalPptOriginalDocument: draft.proposalPptOriginalDocument,
    presentationPptOriginalDocument: draft.presentationPptOriginalDocument,
    rfpRequestEvidenceDocument: draft.rfpRequestEvidenceDocument,
    customerBusinessRegistrationDocument: draft.customerBusinessRegistrationDocument,
    performanceCertificateDocument: draft.performanceCertificateDocument,
    taxInvoiceDocument: draft.taxInvoiceDocument,
    finalSettlementReportDocument: draft.finalSettlementReportDocument,
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
    ? (buildProjectEditorReviewChanges(options.baseProject, draft) || [])
    : [];
  const patch: Partial<Project> = {
    name: text(draft.name),
    officialContractName: text(draft.officialContractName),
    type: normalizeProjectType(draft.type),
    currency: normalizeProjectCurrency(draft.currency),
    contractAmount: nonNegativeAmount(draft.contractAmount),
    contractStart: text(draft.contractStart),
    contractEnd: text(draft.contractEnd),
    settlementType: normalizeSettlementType(draft.settlementType),
    basis: normalizeBasis(draft.basis),
    accountType: normalizeAccountType(draft.accountType),
    settlementSystem: normalizeSettlementSystemCode(draft.settlementSystem),
    laborSettlementBasis: normalizeLaborSettlementBasis(draft.laborSettlementBasis),
    fundInputMode: normalizeProjectFundInputMode(draft.fundInputMode),
    settlementSheetPolicy: normalizeSettlementSheetPolicy(draft.settlementSheetPolicy, normalizeProjectFundInputMode(draft.fundInputMode)),
    paymentPlan: normalizePaymentPlan(draft.paymentPlan),
    paymentExpectedMonths: normalizePaymentExpectedMonths(draft.paymentExpectedMonths),
    laborTransferPlan: normalizeLaborTransferPlan(draft.laborTransferPlan),
    advanceInterimBelow70Reason: text(draft.advanceInterimBelow70Reason),
    paymentPlanDesc: text(draft.paymentPlanDesc),
    clientOrg: text(draft.clientOrg),
    groupwareName: text(draft.name),
    participantCondition: text(draft.participantCondition),
    note: text(draft.note),
    teamMembersDetailed,
    contractType: normalizeProjectContractType(draft.contractType),
    projectPurpose: text(draft.projectPurpose),
    totalRevenueAmount: nonNegativeAmount(draft.totalRevenueAmount),
    supportAmount: nonNegativeAmount(draft.supportAmount),
    salesVatAmount: nonNegativeAmount(draft.salesVatAmount),
    financialInputFlags: flags,
    registrationRequirementsVersion: draft.registrationRequirementsVersion,
    financialYears: draft.financialYears,
    registrationConfirmations: draft.registrationConfirmations,
    registrationOptionalDocumentNotes: draft.registrationOptionalDocumentNotes,
    checkout: draft.checkout,
    settlementGuide: text(draft.settlementGuide),
    contractDocument: draft.contractDocument,
    quoteDocument: draft.quoteDocument,
    proposalDocument: draft.proposalDocument,
    proposalWordOriginalDocument: draft.proposalWordOriginalDocument,
    proposalPptOriginalDocument: draft.proposalPptOriginalDocument,
    presentationPptOriginalDocument: draft.presentationPptOriginalDocument,
    rfpRequestEvidenceDocument: draft.rfpRequestEvidenceDocument,
    customerBusinessRegistrationDocument: draft.customerBusinessRegistrationDocument,
    performanceCertificateDocument: draft.performanceCertificateDocument,
    taxInvoiceDocument: draft.taxInvoiceDocument,
    finalSettlementReportDocument: draft.finalSettlementReportDocument,
    contractAnalysis: draft.contractAnalysis,
    department: normalizeProjectDepartment(draft.department),
    cic: resolveProjectCic({ department: draft.department }),
    teamName: text(draft.teamName),
    registeredById: text(draft.registeredById),
    registeredByName: text(draft.registeredByName),
    registeredByEmail: text(draft.registeredByEmail),
    executiveApproverId: text(draft.executiveApproverId),
    executiveApproverName: text(draft.executiveApproverName),
    executiveApproverEmail: text(draft.executiveApproverEmail),
    managerId: text(draft.registeredById),
    managerName: text(draft.registeredByName),
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
