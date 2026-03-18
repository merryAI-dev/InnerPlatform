import { describe, expect, it } from 'vitest';
import { buildProjectProposalPost, type ProjectProposalDraft } from './project-proposal';

const sampleDraft: ProjectProposalDraft = {
  name: 'KOICA 디지털 역량 강화',
  officialContractName: 'KOICA 디지털 역량 강화 사업 운영 계약',
  type: 'D1',
  description: '현지 파트너 역량 강화 사업',
  clientOrg: 'KOICA',
  department: '임팩트 그룹',
  contractAmount: 120000000,
  salesVatAmount: 12000000,
  totalRevenueAmount: 35000000,
  supportAmount: 60000000,
  contractStart: '2026-03-01',
  contractEnd: '2026-12-31',
  settlementType: 'TYPE1',
  basis: 'SUPPLY_AMOUNT',
  accountType: 'DEDICATED',
  paymentPlanDesc: '선금 50%, 중도 30%, 잔금 20%',
  settlementGuide: '선지급 후 정산, 공급가액 기준',
  projectPurpose: '현지 디지털 전환 역량 강화',
  managerName: '데이나',
  teamName: 'DX Team',
  teamMembers: 'A, B, C',
  teamMembersDetailed: [
    { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60 },
    { memberName: '변민욱', memberNickname: '보람', role: '운영', participationRate: 40 },
  ],
  participantCondition: '전담 2명 이상',
  note: '3월 내 착수 필요',
  contractDocument: null,
};

describe('buildProjectProposalPost', () => {
  it('builds title with proposal prefix', () => {
    const result = buildProjectProposalPost(sampleDraft, '데이나', 'dana@mysc.co.kr');
    expect(result.title).toBe('[사업등록제안] KOICA 디지털 역량 강화');
  });

  it('includes core sections and requester metadata', () => {
    const result = buildProjectProposalPost(sampleDraft, '데이나', 'dana@mysc.co.kr');
    expect(result.body).toContain('요청자: 데이나');
    expect(result.body).toContain('요청자 이메일: dana@mysc.co.kr');
    expect(result.body).toContain('[기본 정보]');
    expect(result.body).toContain('[재무 정보]');
    expect(result.body).toContain('[팀 정보]');
    expect(result.body).toContain('[첨부]');
    expect(result.body).toContain('[추가 메모]');
    expect(result.body).toContain('120,000,000원');
    expect(result.body).toContain('김다은 (데이나) / PM / 60%');
  });

  it('uses fallback text for optional blanks', () => {
    const draft = { ...sampleDraft, description: '', note: '' };
    const result = buildProjectProposalPost(draft, '', '');
    expect(result.body).toContain('요청자: -');
    expect(result.body).toContain('요청자 이메일: -');
    expect(result.body).toContain('- 프로젝트 주요 내용: -');
    expect(result.body).toContain('[추가 메모]\n-');
  });
});
