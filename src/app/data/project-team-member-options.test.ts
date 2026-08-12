import { describe, expect, it } from 'vitest';
import type { DirectoryPerson } from '../platform/person-directory';
import type { OrgMember } from './types';
import {
  buildOrgMemberPickerOptions,
  buildProjectTeamMemberOptions,
  buildTeamMemberDirectory,
  findProjectTeamMemberOption,
} from './project-team-member-options';

/**
 * 사람을 고르는 자리의 출처는 인력 명부(orgs/{org}/persons) 하나다. HR 담당자가 /people
 * 에서 관리한다. 예전에는 코드에 박힌 명단이, 그 다음에는 계정 원장이 출처였다.
 *
 * 여기서 지키는 것 셋:
 *   - 팀원 후보는 명부에서 나오고 인턴은 빠진다
 *   - PM·조직장은 계정이 필수지만 명부에 없으면 후보가 아니다
 *   - 명부를 못 읽어도 사람을 고를 수는 있다
 */

const roster: DirectoryPerson[] = [
  { personId: 'psn-mwbyun1220', name: '변민욱', nickname: '보람', employmentType: 'FULL_TIME' },
  { personId: 'psn-jypark', name: '박지연', nickname: '느티', employmentType: 'FULL_TIME' },
  { personId: 'psn-sykim', name: '김소영', nickname: '소이', employmentType: 'PARTNER' },
  { personId: 'psn-i-intern', name: '한승호', nickname: '숀', employmentType: 'INTERN' },
];

describe('팀원 후보', () => {
  it('출처는 인력 명부다 — 계정이 없어도 고를 수 있다', () => {
    const options = buildProjectTeamMemberOptions(roster);
    expect(options.map((option) => option.label)).toEqual(['김소영(소이)', '박지연(느티)', '변민욱(보람)']);
  });

  it('인턴은 후보에서 빠진다 — 사람에게 붙는 표시가 아니라 근로형태로 가른다', () => {
    expect(buildProjectTeamMemberOptions(roster).map((option) => option.name)).not.toContain('한승호');
  });

  it('파트너는 후보에 남는다 — 실제로 사업에 들어가 있다', () => {
    expect(buildProjectTeamMemberOptions(roster).map((option) => option.name)).toContain('김소영');
  });

  it('라벨은 항상 이름(별명) 으로 정규화된다', () => {
    const withBareName = buildProjectTeamMemberOptions([
      { personId: 'p1', name: '노성진', nickname: '', employmentType: 'PARTNER' },
      { personId: 'p2', name: '강에나', nickname: '하에나', employmentType: 'PARTNER' },
    ]);
    expect(withBareName.map((option) => option.label)).toEqual(['강에나(하에나)', '노성진']);
  });

  it('계정 원장은 이제 후보에 영향을 주지 않는다 — 퇴사 후 계정이 남아도 안 뜬다', () => {
    const options = buildProjectTeamMemberOptions(roster, [
      { uid: 'u-left', name: '김혜령(테일러)', email: 'hlkim@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
    ]);
    expect(options.map((option) => option.name)).not.toContain('김혜령');
  });

  it('명부를 못 읽으면 계정 원장으로 후보를 만든다 — 빈 목록이면 팀원을 아예 못 고른다', () => {
    const options = buildProjectTeamMemberOptions([], [
      { uid: 'u-boram', name: '변민욱(보람)', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
      { uid: 'u-left', name: '퇴사자', email: 'left@mysc.co.kr', role: 'viewer', status: 'INACTIVE' },
    ]);
    expect(options.map((option) => option.label)).toEqual(['변민욱(보람)']);
  });

  it('명부도 계정도 없으면 빈 목록이다 — 코드에 박힌 명단으로 되돌아가지 않는다', () => {
    expect(buildProjectTeamMemberOptions([], [])).toEqual([]);
  });

  it('근로형태를 모르는 명부도 거르지 않는다 — 형태 정보가 없다고 전원을 빼면 아무도 못 고른다', () => {
    const options = buildProjectTeamMemberOptions([{ personId: 'p1', name: '홍길동', nickname: '길동' }]);
    expect(options.map((option) => option.name)).toEqual(['홍길동']);
  });

  it('계약이 끝난 사람은 후보가 아니다', () => {
    const options = buildProjectTeamMemberOptions([
      { personId: 'p1', name: '퇴사자', nickname: '', employmentType: 'NONE' },
      { personId: 'p2', name: '재직자', nickname: '', employmentType: 'FULL_TIME' },
    ]);
    expect(options.map((option) => option.name)).toEqual(['재직자']);
  });
});

describe('PM · 최종 결재자 · 월 결산 조직장 후보', () => {
  const members: OrgMember[] = [
    { uid: 'u-boram', name: '변민욱', nameKo: '변민욱', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
    { uid: 'u-left', name: '김혜령', nameKo: '김혜령', email: 'hlkim@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
    { uid: 'u-bot', name: '(AX) AI', nameKo: '(AX) AI', email: 'ai@mysc.co.kr', role: 'admin', status: 'ACTIVE' },
  ] as OrgMember[];

  it('계정이 있어야 후보다 — 로그인해서 승인해야 하기 때문', () => {
    const options = buildOrgMemberPickerOptions(members, roster);
    expect(options.every((option) => option.uid)).toBe(true);
  });

  it('명부에 없으면 계정이 살아 있어도 후보가 아니다 — 퇴사자와 서비스 계정이 여기서 걸러진다', () => {
    const names = buildOrgMemberPickerOptions(members, roster).map((option) => option.name);
    expect(names).toEqual(['변민욱']);
    expect(names).not.toContain('김혜령');
    expect(names).not.toContain('(AX) AI');
  });

  it('명부에 있어도 계정이 없으면 후보가 아니다 — 승인을 할 수 없다', () => {
    const names = buildOrgMemberPickerOptions(members, roster).map((option) => option.name);
    expect(names).not.toContain('박지연');
  });

  it('별명은 명부에서 채운다', () => {
    expect(buildOrgMemberPickerOptions(members, roster)[0]).toMatchObject({
      nickname: '보람', label: '변민욱(보람)',
    });
  });

  it('명부를 못 읽으면 문지기 없이 계정 원장만 쓴다 — 조직장을 못 고르면 결산이 막힌다', () => {
    const names = buildOrgMemberPickerOptions(members).map((option) => option.name);
    expect(names).toContain('변민욱');
    expect(names).toContain('김혜령');
  });
});

describe('이름 조회', () => {
  it('실명·별명·표시 라벨 어느 쪽으로 물어도 같은 사람을 찾는다', () => {
    const directory = buildTeamMemberDirectory(roster);
    expect(findProjectTeamMemberOption('박지연', directory)?.nickname).toBe('느티');
    expect(findProjectTeamMemberOption('김소영(소이)', directory)?.name).toBe('김소영');
  });

  it('명부 없이 물으면 표시 라벨에 들어있는 별명만 쓴다', () => {
    expect(findProjectTeamMemberOption('김소영(소이)')?.nickname).toBe('소이');
    expect(findProjectTeamMemberOption('박지연')).toBeUndefined();
  });

  it('buildTeamMemberDirectory 는 명부 레코드를 그대로 받는다', () => {
    const built = buildTeamMemberDirectory(roster);
    expect(built.resolveId('변민욱')).toBe('psn-mwbyun1220');
    expect(built.resolveId('하에나')).toBeNull();
  });
});
