import { describe, expect, it } from 'vitest';
import type { OrgMember } from './types';
import {
  buildOrgMemberPickerOptions,
  buildProjectTeamMemberOptions,
  regularizeProjectOwnerNames,
} from './project-team-member-options';

function member(overrides: Partial<OrgMember>): OrgMember {
  return {
    uid: 'u1',
    name: '',
    email: 'someone@mysc.co.kr',
    role: 'pm',
    status: 'ACTIVE',
    ...overrides,
  };
}

// Sign-in and role changes still write the combined `name` string with whatever the Google
// account is called. Screens read nameKo and nickname instead, so those writes stop
// deciding what anyone sees.
describe('display name comes from the roster fields', () => {
  it('ignores a Google account name once the roster fields are present', () => {
    const [option] = buildOrgMemberPickerOptions([
      member({ name: 'Jeongtae KIM (Able)', nameKo: '김정태', nickname: '에이블' }),
    ]);
    expect(option.label).toBe('김정태(에이블)');
    expect(option.name).toBe('김정태');
    expect(option.nickname).toBe('에이블');
  });

  it('still searches by the Korean name after a sign-in overwrote the combined string', () => {
    const [option] = buildOrgMemberPickerOptions([
      member({ name: 'Minjong(파커) Seo', nameKo: '서민종', nickname: '파커' }),
    ]);
    expect(option.searchText).toContain('서민종');
    expect(option.searchText).toContain('파커');
  });

  it('falls back to parsing the combined string when the roster fields are missing', () => {
    const [option] = buildOrgMemberPickerOptions([
      member({ name: '하송희(솔)' }),
    ]);
    expect(option.label).toBe('하송희(솔)');
  });

  it('applies the same rule to the team member picker fallback', () => {
    // 팀원 후보의 출처는 인력 명부지만, 명부를 못 읽었을 때 쓰는 계정 원장 경로에도
    // 같은 이름 정규화가 적용되어야 한다.
    const options = buildProjectTeamMemberOptions([], [
      member({ uid: 'u1', name: 'Inhyo Ko (베리)', nameKo: '고인효', nickname: '베리' }),
    ]);
    expect(options[0].label).toBe('고인효(베리)');
    expect(options[0].value).toBe('고인효');
  });

  it('keeps one entry per person when both documents disagree on the combined string', () => {
    const options = buildProjectTeamMemberOptions([], [
      member({ uid: 'u1', name: 'Jeongtae KIM (Able)', nameKo: '김정태', nickname: '에이블' }),
      member({ uid: 'u2', name: '김정태(에이블)', nameKo: '김정태', nickname: '에이블' }),
    ]);
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('김정태(에이블)');
  });

  it('regularizes every project owner display from the roster UID', () => {
    const project = regularizeProjectOwnerNames({
      id: 'p1',
      name: '프로젝트',
      registeredById: 'u1',
      registeredByName: 'Berry',
      managerId: 'u1',
      managerName: 'Berry',
    } as never, [
      member({ uid: 'u1', name: 'Inhyo Ko', nameKo: '고인효', nickname: '베리' }),
    ]);

    expect(project.registeredByName).toBe('고인효(베리)');
    expect(project.managerName).toBe('고인효(베리)');
  });
});
