import { describe, expect, it } from 'vitest';
import type { ParticipationEntry, SettlementSystemCode } from './types';
import {
  buildParticipationRiskReport,
  computeMemberSummaries,
  PARTICIPATION_RISK_RULESET,
} from './participation-data';

function makeEntry(params: {
  memberId: string;
  memberName: string;
  rate: number;
  settlementSystem: SettlementSystemCode;
  clientOrg: string;
  projectId: string;
  projectName: string;
}): ParticipationEntry {
  return {
    id: `${params.memberId}-${params.projectId}`,
    memberId: params.memberId,
    memberName: params.memberName,
    projectId: params.projectId,
    projectName: params.projectName,
    rate: params.rate,
    settlementSystem: params.settlementSystem,
    clientOrg: params.clientOrg,
    periodStart: '2026-01',
    periodEnd: '2026-12',
    isDocumentOnly: false,
    note: '',
    updatedAt: '2026-02-24T00:00:00.000Z',
  };
}

describe('participation risk rules (deterministic)', () => {
  it('marks DANGER when e나라도움 합산이 100%를 초과', () => {
    const entries = [
      makeEntry({
        memberId: 'm1',
        memberName: '홍길동',
        rate: 60,
        settlementSystem: 'E_NARA_DOUM',
        clientOrg: '환경부/한국환경산업기술원',
        projectId: 'p1',
        projectName: 'A',
      }),
      makeEntry({
        memberId: 'm1',
        memberName: '홍길동',
        rate: 50,
        settlementSystem: 'E_NARA_DOUM',
        clientOrg: '환경부/한국환경산업기술원',
        projectId: 'p2',
        projectName: 'B',
      }),
    ];

    const [summary] = computeMemberSummaries(entries);
    expect(summary.riskLevel).toBe('DANGER');
    expect(summary.eNaraRate).toBe(110);
    expect(summary.riskDetails[0]).toContain('e나라도움 시스템 합산 110%');
  });

  it('marks DANGER when KOICA 기관 합산이 100%를 초과', () => {
    const entries = [
      makeEntry({
        memberId: 'm2',
        memberName: '김철수',
        rate: 90,
        settlementSystem: 'ACCOUNTANT',
        clientOrg: 'KOICA',
        projectId: 'k1',
        projectName: 'K1',
      }),
      makeEntry({
        memberId: 'm2',
        memberName: '김철수',
        rate: 30,
        settlementSystem: 'ACCOUNTANT',
        clientOrg: '한국국제협력단',
        projectId: 'k2',
        projectName: 'K2',
      }),
    ];

    const [summary] = computeMemberSummaries(entries);
    expect(summary.riskLevel).toBe('DANGER');
    expect(summary.riskDetails.some((d) => d.includes('동일 기관 100% 초과'))).toBe(true);
  });

  it('marks WARNING when e나라도움이 100% exactly', () => {
    const entries = [
      makeEntry({
        memberId: 'm3',
        memberName: '이영희',
        rate: 100,
        settlementSystem: 'E_NARA_DOUM',
        clientOrg: '환경부/한국환경산업기술원',
        projectId: 'e1',
        projectName: 'E1',
      }),
    ];

    const [summary] = computeMemberSummaries(entries);
    expect(summary.riskLevel).toBe('WARNING');
    expect(summary.riskDetails[0]).toContain('경고 수준');
  });

  it('marks WARNING on e나라도움 + 회계사정산 cross potential risk', () => {
    const entries = [
      makeEntry({
        memberId: 'm4',
        memberName: '박민수',
        rate: 40,
        settlementSystem: 'E_NARA_DOUM',
        clientOrg: '환경부/한국환경산업기술원',
        projectId: 'c1',
        projectName: 'C1',
      }),
      makeEntry({
        memberId: 'm4',
        memberName: '박민수',
        rate: 70,
        settlementSystem: 'ACCOUNTANT',
        clientOrg: '농림식품부/한국농업기술진흥원',
        projectId: 'c2',
        projectName: 'C2',
      }),
    ];

    const [summary] = computeMemberSummaries(entries);
    expect(summary.riskLevel).toBe('WARNING');
    expect(summary.riskDetails.some((d) => d.includes('교차 잠재 위험'))).toBe(true);
  });

  it('builds reproducible report payload shape with ruleset version', () => {
    const entries = [
      makeEntry({
        memberId: 'm5',
        memberName: '최가람',
        rate: 30,
        settlementSystem: 'PRIVATE',
        clientOrg: '민간기관',
        projectId: 'r1',
        projectName: 'R1',
      }),
    ];

    const report = buildParticipationRiskReport(entries);
    expect(report.rulesetVersion).toBe(PARTICIPATION_RISK_RULESET.version);
    expect(report.totalMembers).toBe(1);
    expect(report.rows[0]?.name).toBe('최가람');
  });
});
