import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  formatSettlementSheetPolicySummary,
  getDefaultSettlementSheetPolicyForFundInputMode,
  normalizeSettlementSheetPolicy,
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  type AccountType,
  type Basis,
  type ProjectFundInputMode,
  type ProjectRequestContractAnalysis,
  type SettlementSheetPolicy,
  type ProjectTeamMemberAssignment,
  type ProjectType,
  type SettlementType,
  type ProjectFinancialInputFlags,
} from '../../data/types';
import { formatProjectTeamMembersSummary } from '../../platform/project-team-members';
import { formatStoredProjectAmount } from '../../platform/project-contract-amount';

export interface ProjectProposalDraft {
  name: string;
  officialContractName: string;
  type: ProjectType;
  description: string;
  clientOrg: string;
  department: string;
  contractAmount: number;
  salesVatAmount: number;
  totalRevenueAmount: number;
  supportAmount: number;
  financialInputFlags?: ProjectFinancialInputFlags;
  contractStart: string;
  contractEnd: string;
  settlementType: SettlementType;
  basis: Basis;
  accountType: AccountType;
  fundInputMode: ProjectFundInputMode;
  settlementSheetPolicy?: SettlementSheetPolicy;
  paymentPlanDesc: string;
  settlementGuide: string;
  projectPurpose: string;
  managerName: string;
  teamName: string;
  teamMembers: string;
  teamMembersDetailed: ProjectTeamMemberAssignment[];
  participantCondition: string;
  note: string;
  contractDocument: import('../../data/types').FileAttachment | null;
  contractAnalysis?: ProjectRequestContractAnalysis | null;
}

export interface ProjectProposalPostPayload {
  title: string;
  body: string;
  tagsInput: string;
}

export function buildProjectProposalPost(
  draft: ProjectProposalDraft,
  requesterName: string,
  requesterEmail: string,
): ProjectProposalPostPayload {
  const projectName = String(draft.name || '').trim() || '제목 미입력 사업';
  const officialContractName = String(draft.officialContractName || '').trim() || '-';
  const teamMembersSummary = formatProjectTeamMembersSummary(draft.teamMembersDetailed, draft.teamMembers);
  const settlementSheetPolicy = normalizeSettlementSheetPolicy(
    draft.settlementSheetPolicy,
    draft.fundInputMode,
  ) || getDefaultSettlementSheetPolicyForFundInputMode(draft.fundInputMode);
  const title = `[사업등록제안] ${projectName}`;

  const body = [
    '신규 사업 등록 제안이 접수되었습니다.',
    '',
    `요청자: ${requesterName || '-'}`,
    `요청자 이메일: ${requesterEmail || '-'}`,
    '',
    '[기본 정보]',
    `- 등록 프로젝트명: ${projectName}`,
    `- 공식 계약명: ${officialContractName}`,
    `- 사업 유형: ${PROJECT_TYPE_LABELS[draft.type]}`,
    `- 계약 대상: ${draft.clientOrg || '-'}`,
    `- 담당팀: ${draft.department || '-'}`,
    `- 프로젝트 목적: ${draft.projectPurpose || '-'}`,
    `- 프로젝트 주요 내용: ${draft.description || '-'}`,
    '',
    '[재무 정보]',
    `- 계약금액: ${formatStoredProjectAmount(draft.contractAmount, draft.financialInputFlags?.contractAmount)}`,
    `- 매출 부가세: ${formatStoredProjectAmount(draft.salesVatAmount, draft.financialInputFlags?.salesVatAmount)}`,
    `- 총수익: ${formatStoredProjectAmount(draft.totalRevenueAmount, draft.financialInputFlags?.totalRevenueAmount)}`,
    `- 지원금: ${formatStoredProjectAmount(draft.supportAmount, draft.financialInputFlags?.supportAmount)}`,
    `- 계약기간: ${draft.contractStart || '-'} ~ ${draft.contractEnd || '-'}`,
    `- 정산 유형: ${SETTLEMENT_TYPE_LABELS[draft.settlementType]}`,
    `- 기준: ${BASIS_LABELS[draft.basis]}`,
    `- 계좌 유형: ${ACCOUNT_TYPE_LABELS[draft.accountType]}`,
    `- 자금 입력 방식: ${PROJECT_FUND_INPUT_MODE_LABELS[draft.fundInputMode]}`,
    `- 정산 시트 정책: ${formatSettlementSheetPolicySummary(settlementSheetPolicy)}`,
    `- 선금/중도금/잔금 및 입금 계획: ${draft.paymentPlanDesc || '-'}`,
    `- 사업비 수령 방식 및 정산 기준: ${draft.settlementGuide || '-'}`,
    '',
    '[팀 정보]',
    `- 담당자: ${draft.managerName || '-'}`,
    `- 팀원: ${teamMembersSummary}`,
    `- 참여 조건: ${draft.participantCondition || '-'}`,
    '',
    '[첨부]',
    `- 계약서 등(PDF): ${draft.contractDocument?.name || '-'}`,
    `- 첨부 링크: ${draft.contractDocument?.downloadURL || '-'}`,
    '',
    '[추가 메모]',
    draft.note || '-',
  ].join('\n');

  return {
    title,
    body,
    tagsInput: '사업등록제안,포털,승인요청',
  };
}
