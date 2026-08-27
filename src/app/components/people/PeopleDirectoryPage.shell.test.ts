import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PeopleDirectoryPage.tsx'), 'utf8');

/**
 * 근로형태는 이름 옆에 붙으면 신분 표시가 된다. 명부 목록에서는 가리고, 계약을 바꾸는
 * 자리에서만 보여준다. 인턴은 같은 표에 섞지 않는다 - 근로형태 열을 지워도 한 표에
 * 두면 순서와 빈칸으로 드러난다.
 */
describe('PeopleDirectoryPage 근로형태 노출 계약', () => {
  it('목록 표에 근로형태 열이 없다', () => {
    const table = source.slice(source.indexOf('function PeopleTable'), source.indexOf('export function PeopleDirectoryPage'));
    expect(table).not.toContain('근로형태');
    expect(table).not.toContain('TYPE_TONE');
    expect(table).not.toContain('EMPLOYMENT_TYPE_LABELS');
  });

  it('근로형태별 필터 버튼이 없다 — 누르는 것만으로 누가 어느 형태인지 드러난다', () => {
    expect(source).not.toContain("['FULL_TIME', `정규직");
    expect(source).not.toContain("['INTERN', `인턴");
    expect(source).not.toContain("['PARTNER', `파트너");
    expect(source).not.toContain("['PLACEHOLDER', `미채용");
  });

  it('인턴은 별도 표로 뗀다', () => {
    expect(source).toContain("row.current?.type !== 'INTERN'");
    expect(source).toContain("row.current?.type === 'INTERN'");
    expect(source).toContain('const mainRows');
    expect(source).toContain('const internRows');
    // 두 표가 같은 컴포넌트를 쓴다 - 한쪽만 조용히 달라지지 않게.
    expect(source.match(/<PeopleTable/g)).toHaveLength(2);
  });

  it('계약 관리에서는 근로형태를 그대로 보여준다 — 바꾸려면 보여야 한다', () => {
    const dialog = source.slice(source.indexOf('계약 이력'));
    expect(dialog).toContain('EMPLOYMENT_TYPE_LABELS');
  });

  it('목록에는 이름·재직상태·소속·직급·입사일·근속만 둔다', () => {
    const table = source.slice(source.indexOf('function PeopleTable'), source.indexOf('export function PeopleDirectoryPage'));
    ['이름', '재직상태', '소속', '직급', '입사일', '근속'].forEach((column) => {
      expect(table).toContain(`>${column}</TableHead>`);
    });
  });
});

describe('PeopleDirectoryPage 전문 프로필 조립 계약', () => {
  it('서버 capability만 보관하고 역할명으로 권한을 추론하지 않는다', () => {
    expect(source).toContain('response.capabilities.professionalProfileRead === true');
    expect(source).toContain('response.capabilities.professionalProfileWrite === true');
    expect(source).toContain('scopedProfileCapabilities.read');
    expect(source).toContain('scopedProfileCapabilities.write');
    expect(source).not.toContain("authUser.role === 'admin'");
    expect(source).not.toContain("authUser.role === 'finance'");
  });

  it('목록 요청을 취소하고 stale 목록·capability를 요청 시작 시 닫는다', () => {
    expect(source).toContain('const peopleLoadSequenceRef = useRef(0)');
    expect(source).toContain('peopleLoadControllerRef.current?.abort()');
    expect(source).toContain('const controller = new AbortController()');
    expect(source).toContain('signal: controller.signal');
    expect(source).toContain('setPeople([])');
    expect(source).toContain("setProfileCapabilities({ read: false, write: false })");
    expect(source).toContain('sequence !== peopleLoadSequenceRef.current || controller.signal.aborted) return');
    expect(source).not.toContain("useEffect(() => { void load(); }, [orgId, authUser?.uid, authUser?.idToken])");
  });

  it('인증이 사라져도 기존 목록·capability를 먼저 fail-close한다', () => {
    const load = source.slice(source.indexOf('const load = async () => {'), source.indexOf('  useEffect(() => {', source.indexOf('const load = async () => {')));
    const actorGuard = load.indexOf('if (!actor || !actor.idToken || !featureFlags.platformApiEnabled)');

    expect(actorGuard).toBeGreaterThan(-1);
    expect(load.indexOf('peopleLoadSequenceRef.current = sequence')).toBeLessThan(actorGuard);
    expect(load.indexOf('setPeople([])')).toBeLessThan(actorGuard);
    expect(load.indexOf("setProfileCapabilities({ read: false, write: false })")).toBeLessThan(actorGuard);
    expect(load.indexOf('setProfilePerson(null)')).toBeLessThan(actorGuard);
    expect(load.indexOf('setNewProfessionalProfile(null)')).toBeLessThan(actorGuard);
  });

  it('tenant·actor 경계가 바뀌면 열린 신규 입력과 재시도 attempt를 폐기한다', () => {
    expect(source).toContain('const directoryScopeKey =');
    expect(source).toContain('directoryScopeRef.current = directoryScopeKey');
    expect(source).toContain('if (directoryScopeRef.current !== directoryScopeKey) return');
    expect(source).toContain("setSearchText('');\n    setNewPerson({ name: '', nickname: '', departmentTop: '', title: '' });\n    setDraft(emptyDraft());\n    setAddOpen(false);");
    expect(source).toContain('createAttemptRef.current = null;\n    void load();');
    expect(source).toContain('if (directoryScopeRef.current !== submitScope || mutationSequenceRef.current !== mutationSequence) return');
    expect(source).toContain('if (directoryScopeRef.current === submitScope && mutationSequenceRef.current === mutationSequence)');
  });

  it('인증 준비 전후에는 목록을 불러오되 token-to-token 갱신에는 draft를 초기화하지 않는다', () => {
    expect(source).toContain('const actorReady = Boolean(authUser?.idToken)');
    expect(source).toContain('[orgId, authUser?.uid, authUser?.role, actorReady]');
    expect(source).not.toContain('[orgId, authUser?.uid, authUser?.role, authUser?.idToken]');
  });

  it('effect가 실행되기 전에도 현재 tenant·actor scope가 소유한 목록과 capability만 렌더한다', () => {
    expect(source).toContain('const loadedDirectoryScopeRef = useRef<string | null>(null)');
    expect(source).toContain('const directoryScopeLoaded = loadedDirectoryScopeRef.current === directoryScopeKey');
    expect(source).toContain('const scopedPeople = directoryScopeLoaded ? people : []');
    expect(source).toContain('const scopedProfileCapabilities = directoryScopeLoaded');
    expect(source).toContain('directoryScopeLoaded ? findUnregisteredAssignees(projects, scopedPeople) : []');
    expect(source).toContain("value={directoryScopeLoaded ? searchText : ''}");
    expect(source).toContain('{directoryScopeLoaded && error ? (');
    expect(source).toContain('open={!!selected && directoryScopeLoaded}');
    expect(source).toContain('open={addOpen && directoryScopeLoaded}');
  });

  it('사람별 진입점은 인사정보 콘솔 하나이고, 학력 편집기는 거기서 이어 연다', () => {
    // 계약 관리와 전문 프로필이 서로 다른 창이라 같은 사람을 두 번 열어야 했다.
    expect(source).toContain('<PersonHrConsole');
    expect(source).toContain('aria-label={`${person.name} 인사정보`}');
    expect(source).toContain('canReadProfile={scopedProfileCapabilities.read}');
    expect(source).toContain('canWriteProfile={scopedProfileCapabilities.write}');
    expect(source).toContain('onEditProfessionalProfile={');
    expect(source).toContain('onManageEmployment={');
    expect(source).toContain('profilePerson && scopedProfileCapabilities.read');
    expect(source).toContain('<ProfessionalProfileEditor');
    // 직급과 직책은 다른 축이라 표에서도 칸을 나눈다.
    expect(source).toContain('{person.grade || \'-\'}');
    expect(source).toContain('{person.title || \'-\'}');
  });

  it('신규 등록은 쓰기 capability와 실제 입력이 있을 때만 프로필을 POST한다', () => {
    expect(source).toContain('scopedProfileCapabilities.write ? (');
    expect(source).toContain('<NewPersonProfessionalProfileFields');
    expect(source).toContain('...(newProfessionalProfile ? { professionalProfile: newProfessionalProfile } : {})');
    expect(source).toContain('setNewProfessionalProfile(null)');
    expect(source).toContain('createAttemptRef.current?.fingerprint !== fingerprint');
    expect(source).toContain('idempotencyKey: createAttemptRef.current.key');
    expect(source).toContain('createAttemptRef.current = null');
  });

  it('전문 프로필을 PersonRecord나 people 목록에 합치지 않는다', () => {
    expect(source).not.toContain('setPeople((prev) => prev.map((item) => ({ ...item, professionalProfile');
    expect(source).not.toContain('selected.professionalProfile');
  });
});
