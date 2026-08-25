import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ParticipationPage.tsx'), 'utf8');

describe('ParticipationPage server snapshot contract', () => {
  it('renders the BFF snapshot without client-side participation calculation', () => {
    expect(source).toContain('fetchParticipationDashboardViaBff');
    expect(source).toContain('snapshot.members.map');
    expect(source).toContain('member.months.map');
    expect(source).toContain("searchParams.get('year') || '2026'");
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
    expect(source).toContain('[requestKey]');
    expect(source).not.toContain('projects.reduce');

    const toggleSource = source.slice(source.indexOf('const toggleMember'), source.indexOf('const toggleMember') + 500);
    expect(toggleSource).not.toContain('fetch');
  });

  it('shows server-owned profile columns and filters only with explicit access', () => {
    expect(source).toContain('snapshot.professionalProfileAccess === true');
    expect(source).toContain('snapshot.profileFilterOptions');
    expect(source).toContain('<ParticipationProfileFilters');
    expect(source).toContain('member.profileSummary?.highestEducationDisplayText');
    expect(source).toContain('member.profileSummary?.englishEvidenceDisplayText');
    expect(source).toContain('member.profileSummary?.certificationsDisplayText');
    expect(source).toContain("display === '—' ? '미입력'");
  });

  it('passes filter codes to an abortable server request and never renders stale rows', () => {
    expect(source).toContain('const controller = new AbortController()');
    expect(source).toContain('signal: controller.signal');
    expect(source).toContain('snapshotRequestKey === requestKey');
    expect(source).toContain('참여율 결과를 불러오는 중입니다.');
    expect(source).toContain('controller.abort()');
    expect(source).toContain('education: education || undefined');
    expect(source).toContain('englishEvidence: englishEvidence || undefined');
    expect(source).toContain('certifications,');
    expect(source).not.toContain('snapshot.members.filter');
    expect(source).not.toContain('profileFilterOptions.reduce');
  });

  it('debounces only profile filter requests while keeping scope and View changes immediate', () => {
    expect(source).toContain('PROFILE_FILTER_DEBOUNCE_MS = 200');
    expect(source).toContain('previousImmediateRequestKeyRef');
    expect(source).toContain('shouldDebounceProfileFilters');
    expect(source).toContain('window.setTimeout(runRequest, PROFILE_FILTER_DEBOUNCE_MS)');
    expect(source).toContain('window.clearTimeout(debounceTimer)');
  });

  it('toggles certifications against the current URL to avoid rapid lost updates', () => {
    expect(source).toContain('pendingSearchParamsRef.current || current');
    expect(source).toContain('pendingSearchParamsRef.current = next');
    expect(source).toContain("navigationType === 'POP'");
    expect(source).toContain('previousImmediateUrlScopeKeyRef.current !== immediateUrlScopeKey');
    expect(source).toContain("const currentValues = next.getAll('certification')");
    expect(source).toContain("value === '__MISSING__'");
    expect(source).toContain('withoutMissing.length >= 20');
    expect(source).toContain('onCertificationToggle={toggleCertificationValue}');
  });

  it('uses the URL as bidirectional filter state and only replaces server canonicalization', () => {
    expect(source).toContain("searchParams.get('view') || 'all'");
    expect(source).toContain("searchParams.getAll('certification')");
    expect(source).toContain('setSearchParams((current) =>');
    expect(source).toContain('{ replace: false }');
    expect(source).toContain('{ replace: true }');
    expect(source).not.toContain('useState<string[]>(searchParams.getAll');
  });

  it('fails closed across auth scopes without treating token refresh as a new scope', () => {
    expect(source).toContain('buildParticipationDashboardAuthScopeKey(orgId, user)');
    expect(source).toContain('snapshotAuthScopeKey === authScopeKey');
    expect(source).toContain('[requestKey, authScopeKey, refreshToken]');
    expect(source).not.toContain('[requestKey, orgId, refreshToken, user]');
  });

  it('keeps retry and clear recovery available for active-filter errors', () => {
    expect(source).toContain('데이터 필터를 초기화하고 다시 조회');
    expect(source).toContain('다시 시도');
    expect(source).toContain('clearProfileFilters');
    expect(source).toContain("next.delete('education')");
    expect(source).toContain("next.delete('englishEvidence')");
    expect(source).toContain("next.delete('certification')");
  });

  it('shows the server result length and separates filtered from unfiltered empty states', () => {
    expect(source).toContain('조회 결과 {snapshot.members.length}명');
    expect(source).toContain('선택한 데이터 필터에 맞는 참여자가 없습니다.');
    expect(source).toContain('선택한 범위에 등록된 프로젝트 참여자가 없습니다.');
    expect(source).not.toContain('members.reduce');
  });

  it('shows settlement project counts without disabling zero-count options', () => {
    expect(source).toContain("Number(system.projectCount) || 0");
    expect(source).toContain('{system.label} · {Number(system.projectCount) || 0}개');
    expect(source).not.toContain('disabled={!system.projectCount}');
    expect(source).not.toContain('disabled={Number(system.projectCount) === 0}');
  });
});
