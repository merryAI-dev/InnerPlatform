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

  it('discloses saved-rule projects inline without a request or client aggregation', () => {
    expect(source).toContain("snapshot.selectedRule.id !== 'all'");
    expect(source).toContain('const projects = member.projects || []');
    expect(source).toContain('projects.length');
    expect(source).toContain('projects.map');
    expect(source).toContain('project.months.map');
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain('aria-controls={`participation-projects-${member.memberId}`}');
    expect(source).toContain("`${member.memberName}의 프로젝트 ${projects.length}개 ${isExpanded ? '접기' : '펼치기'}`");
    expect(source).toContain('useState<Set<string>>(new Set())');
    expect(source).toContain('setExpandedMemberIds(new Set())');
    expect(source).toContain('[selectedRuleId, selectedYear]');
    expect(source).not.toContain('projects.reduce');

    const toggleSource = source.slice(source.indexOf('const toggleMember'), source.indexOf('const toggleMember') + 500);
    expect(toggleSource).not.toContain('fetch');
  });

  it('shows settlement project counts without disabling zero-count options', () => {
    expect(source).toContain("Number(system.projectCount) || 0");
    expect(source).toContain('{system.label} · {Number(system.projectCount) || 0}개');
    expect(source).not.toContain('disabled={!system.projectCount}');
    expect(source).not.toContain('disabled={Number(system.projectCount) === 0}');
  });
});
