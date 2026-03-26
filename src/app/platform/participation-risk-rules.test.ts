import { describe, expect, it } from 'vitest';
import { detectParticipationRisk } from './participation-risk-rules';
import type { ParticipationEntry } from '../data/types';

function makeEntry(overrides: {
  memberId: string;
  memberName: string;
  rate: number;
  projectId?: string;
  projectName?: string;
  settlementSystem?: ParticipationEntry['settlementSystem'];
  clientOrg?: string;
}): ParticipationEntry {
  return {
    id: `entry-${Math.random()}`,
    memberId: overrides.memberId,
    memberName: overrides.memberName,
    projectId: overrides.projectId ?? 'proj-1',
    projectName: overrides.projectName ?? '테스트 사업',
    projectShortName: '',
    rate: overrides.rate,
    settlementSystem: overrides.settlementSystem ?? 'E_NARA_DOUM',
    clientOrg: overrides.clientOrg ?? '행정안전부',
    periodStart: '2026-01',
    periodEnd: '2026-12',
    isDocumentOnly: false,
    note: '',
    updatedAt: '2026-01-01',
  };
}

describe('detectParticipationRisk', () => {
  it('100% 이하이면 위험 없음', () => {
    const entries = [
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 50, projectId: 'p1' }),
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 40, projectId: 'p2' }),
    ];
    const result = detectParticipationRisk(entries);
    expect(result.hasOverLimit).toBe(false);
    expect(result.overLimitMembers).toHaveLength(0);
  });

  it('합산 100% 초과 시 overLimit 감지', () => {
    const entries = [
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 70, projectId: 'p1' }),
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 50, projectId: 'p2' }),
    ];
    const result = detectParticipationRisk(entries);
    expect(result.hasOverLimit).toBe(true);
    expect(result.overLimitMembers[0].memberName).toBe('홍길동');
    expect(result.overLimitMembers[0].totalRate).toBe(120);
  });

  it('80% 초과 ~ 100% 이하는 경고', () => {
    const entries = [
      makeEntry({ memberId: 'u1', memberName: '김철수', rate: 50, projectId: 'p1' }),
      makeEntry({ memberId: 'u1', memberName: '김철수', rate: 40, projectId: 'p2' }),
    ];
    const result = detectParticipationRisk(entries);
    expect(result.hasOverLimit).toBe(false);
    expect(result.hasWarning).toBe(true);
    expect(result.warningMembers[0].totalRate).toBe(90);
  });

  it('filterMemberNames로 특정 직원만 체크', () => {
    const entries = [
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 70, projectId: 'p1' }),
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 50, projectId: 'p2' }),
      makeEntry({ memberId: 'u2', memberName: '이영희', rate: 30, projectId: 'p3' }),
    ];
    // 이영희만 체크하면 위험 없음
    const result = detectParticipationRisk(entries, ['이영희']);
    expect(result.hasOverLimit).toBe(false);
  });

  it('빈 entries면 위험 없음', () => {
    const result = detectParticipationRisk([]);
    expect(result.hasOverLimit).toBe(false);
    expect(result.hasWarning).toBe(false);
  });

  it('PRIVATE/NONE 시스템은 교차검증 제외', () => {
    const entries = [
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 80, projectId: 'p1', settlementSystem: 'PRIVATE' }),
      makeEntry({ memberId: 'u1', memberName: '홍길동', rate: 80, projectId: 'p2', settlementSystem: 'E_NARA_DOUM' }),
    ];
    // PRIVATE는 교차검증 대상 아님, e나라도움 단일 80% → MEDIUM(경고)
    const result = detectParticipationRisk(entries);
    expect(result.hasOverLimit).toBe(false);
  });
});
