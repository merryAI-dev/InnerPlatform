import { ACCOUNT_TYPE_LABELS, BASIS_LABELS, PROJECT_TYPE_LABELS, SETTLEMENT_TYPE_LABELS, type AccountType, type Basis, type ProjectType, type SettlementType } from '../../data/types';

export interface ProjectProposalDraft {
  name: string;
  type: ProjectType;
  description: string;
  clientOrg: string;
  department: string;
  contractAmount: number;
  contractStart: string;
  contractEnd: string;
  settlementType: SettlementType;
  basis: Basis;
  accountType: AccountType;
  paymentPlanDesc: string;
  managerName: string;
  teamName: string;
  teamMembers: string;
  participantCondition: string;
  note: string;
}

export interface ProjectProposalPostPayload {
  title: string;
  body: string;
  tagsInput: string;
}

function fmtCurrency(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('ko-KR') : '0';
}

export function buildProjectProposalPost(
  draft: ProjectProposalDraft,
  requesterName: string,
  requesterEmail: string,
): ProjectProposalPostPayload {
  const projectName = String(draft.name || '').trim() || '제목 미입력 사업';
  const title = `[사업등록제안] ${projectName}`;

  const body = [
    '신규 사업 등록 제안이 접수되었습니다.',
    '',
    `요청자: ${requesterName || '-'}`,
    `요청자 이메일: ${requesterEmail || '-'}`,
    '',
    '[기본 정보]',
    `- 사업명: ${projectName}`,
    `- 사업 유형: ${PROJECT_TYPE_LABELS[draft.type]}`,
    `- 발주기관: ${draft.clientOrg || '-'}`,
    `- 담당조직: ${draft.department || '-'}`,
    `- 사업 설명: ${draft.description || '-'}`,
    '',
    '[재무 정보]',
    `- 계약금액: ${fmtCurrency(draft.contractAmount)}원`,
    `- 계약기간: ${draft.contractStart || '-'} ~ ${draft.contractEnd || '-'}`,
    `- 정산 유형: ${SETTLEMENT_TYPE_LABELS[draft.settlementType]}`,
    `- 기준: ${BASIS_LABELS[draft.basis]}`,
    `- 계좌 유형: ${ACCOUNT_TYPE_LABELS[draft.accountType]}`,
    `- 입금 계획: ${draft.paymentPlanDesc || '-'}`,
    '',
    '[팀 정보]',
    `- 담당자: ${draft.managerName || '-'}`,
    `- 팀명: ${draft.teamName || '-'}`,
    `- 팀원: ${draft.teamMembers || '-'}`,
    `- 참여 조건: ${draft.participantCondition || '-'}`,
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

