import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ParticipationPage.tsx'), 'utf8');

describe('ParticipationPage server snapshot contract', () => {
  it('renders the BFF snapshot without client-side participation calculation', () => {
    expect(source).toContain('fetchParticipationDashboardViaBff');
    expect(source).toContain('snapshot.members.map');
    expect(source).toContain('member.months.map');
    expect(source).toContain("useState('2026')");
    expect(source).toContain('프로젝트 {member.projectCount}개');
    expect(source).not.toContain('reduce(');
    expect(source).not.toContain('buildAllProjectTeamParticipationEntries');
    expect(source).not.toContain('getMonthlyParticipationRate');
    expect(source).not.toContain('computeMemberSummaries');
  });

  it('does not retain fixed settlement or cross-verification classifications', () => {
    expect(source).not.toContain('KOICA');
    expect(source).not.toContain('교차검증');
    expect(source).not.toContain('PARTICIPATION_RISK_RULESET');
  });

  it('renders confirmed zero separately from missing sheet input', () => {
    expect(source).toContain('month.isConfirmed');
    expect(source).toContain('month.hasMissing');
    expect(source).toContain("`${month.rate}%`");
    expect(source).toContain('미입력 있음');
    expect(source).toContain("'미입력'");
  });

  it('explains that saved rule filters can leave either dimension open', () => {
    expect(source).toContain('선택하지 않은 조건은 해당 구분을 제한하지 않습니다.');
    expect(source).toContain('같은 조건 안에서는 여러 값을 함께 선택할 수 있습니다.');
  });

  it('exposes saved rules and years as explicit View filters', () => {
    expect(source).toContain('aria-label="참여율 View"');
    expect(source).toContain('aria-label="참여율 연도"');
    expect(source).toContain('View');
  });
});
