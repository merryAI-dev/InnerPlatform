import { describe, expect, it } from 'vitest';
import { buildProjectProposalPost, type ProjectProposalDraft } from './project-proposal';

const sampleDraft: ProjectProposalDraft = {
  name: 'KOICA 디지털 역량 강화',
  type: 'DEV_COOPERATION',
  description: '현지 파트너 역량 강화 사업',
  clientOrg: 'KOICA',
  department: '임팩트 그룹',
  contractAmount: 120000000,
  contractStart: '2026-03-01',
  contractEnd: '2026-12-31',
  settlementType: 'TYPE1',
  basis: 'SUPPLY_AMOUNT',
  accountType: 'DEDICATED',
  paymentPlanDesc: '선금 50%, 중도 30%, 잔금 20%',
  managerName: '데이나',
  teamName: 'DX Team',
  teamMembers: 'A, B, C',
  participantCondition: '전담 2명 이상',
  note: '3월 내 착수 필요',
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
    expect(result.body).toContain('[추가 메모]');
    expect(result.body).toContain('120,000,000원');
  });

  it('uses fallback text for optional blanks', () => {
    const draft = { ...sampleDraft, description: '', note: '' };
    const result = buildProjectProposalPost(draft, '', '');
    expect(result.body).toContain('요청자: -');
    expect(result.body).toContain('요청자 이메일: -');
    expect(result.body).toContain('- 사업 설명: -');
    expect(result.body).toContain('[추가 메모]\n-');
  });
});

