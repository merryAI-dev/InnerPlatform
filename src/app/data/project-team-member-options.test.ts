import { describe, expect, it } from 'vitest';
import {
  buildProjectTeamMemberOptions,
  buildTeamMemberDirectory,
  findProjectTeamMemberOption,
} from './project-team-member-options';

/**
 * 예전에는 코드에 박힌 직원 명단(EMPLOYEES)이 후보 목록의 근거였고, 이 파일이 그 명단과의
 * 일치를 지켰다. 지금 근거는 DB 인력 명부(orgs/{org}/persons)라서, 여기서는 "명부를 받았을 때
 * 어떻게 동작하는가"와 "명부가 없어도 사람을 고를 수 있는가"를 지킨다.
 */

const roster = [
  { personId: 'psn-mwbyun1220', name: '변민욱', nickname: '보람' },
  { personId: 'psn-jypark', name: '박지연', nickname: '느티' },
  { personId: 'psn-sykim', name: '김소영', nickname: '소이' },
];

describe('project-team-member-options', () => {
  it('후보 목록의 출처는 계정 원장이고, 비활성 계정은 뺀다', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'u-boram', name: '변민욱', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
      { uid: 'u-new', name: '신규구성원(새별)', email: 'new@mysc.co.kr', role: 'viewer', status: 'ACTIVE' },
      { uid: 'u-left', name: '퇴사자', email: 'left@mysc.co.kr', role: 'viewer', status: 'INACTIVE' },
    ], roster);

    expect(options).toEqual([
      expect.objectContaining({ name: '변민욱', nickname: '보람', label: '변민욱(보람)' }),
      expect.objectContaining({ name: '신규구성원', nickname: '새별', label: '신규구성원(새별)' }),
    ]);
    expect(options.map((option) => option.name)).not.toContain('퇴사자');
  });

  it('명부에만 있고 계정이 없는 사람은 후보에 넣지 않는다 — 고르면 배정이 계정과 어긋난다', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'u-boram', name: '변민욱', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
    ], roster);
    expect(options.map((option) => option.name)).not.toContain('박지연');
  });

  it('계정 문서에 별명이 없으면 명부에서 채운다', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'u-boram', name: '변민욱', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
    ], roster);
    expect(options[0]).toMatchObject({ nickname: '보람', label: '변민욱(보람)' });
  });

  it('계정 문서의 별명이 명부보다 우선한다 — 본인이 고친 값이 이긴다', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'u-boram', name: '변민욱', nickname: '민욱', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
    ], roster);
    expect(options[0]).toMatchObject({ nickname: '민욱', label: '변민욱(민욱)' });
  });

  it('명부가 아직 안 왔어도 후보 목록은 나온다 — 별명만 비고 사람은 고를 수 있다', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'u-boram', name: '변민욱', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
      { uid: 'u-new', name: '신규구성원(새별)', email: 'new@mysc.co.kr', role: 'viewer', status: 'ACTIVE' },
    ]);
    expect(options.map((option) => option.name)).toEqual(['변민욱', '신규구성원']);
    expect(options[0].nickname).toBe('');
  });

  it('계정 목록을 못 받으면 인력 명부로 후보를 만든다 — 빈 목록이면 팀원을 아예 못 고른다', () => {
    const options = buildProjectTeamMemberOptions([], roster);
    expect(options.map((option) => option.label)).toEqual(['김소영(소이)', '박지연(느티)', '변민욱(보람)']);
  });

  it('계정이 전부 비활성이어도 같은 안전망을 쓴다', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'u-left', name: '퇴사자', email: 'left@mysc.co.kr', role: 'viewer', status: 'INACTIVE' },
    ], roster);
    expect(options.length).toBe(3);
  });

  it('명부도 계정도 없으면 빈 목록이다 — 코드에 박힌 명단으로 되돌아가지 않는다', () => {
    expect(buildProjectTeamMemberOptions([], [])).toEqual([]);
  });

  it('후보 라벨은 항상 이름(별명) 으로 정규화된다', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'a', name: '변민욱', email: 'a@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
      { uid: 'b', name: '김소영(소이)', email: 'b@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
      { uid: 'c', name: '박지연', nickname: '느티', email: 'c@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
    ], roster);
    expect(options.map((option) => option.label)).toEqual(['김소영(소이)', '박지연(느티)', '변민욱(보람)']);
  });

  it('실명·별명·표시 라벨 어느 쪽으로 물어도 같은 사람을 찾는다', () => {
    expect(findProjectTeamMemberOption('박지연', buildTeamMemberDirectory(roster))?.nickname).toBe('느티');
    expect(findProjectTeamMemberOption('김소영(소이)', buildTeamMemberDirectory(roster))?.name).toBe('김소영');
  });

  it('명부 없이 물으면 표시 라벨에 들어있는 별명만 쓴다', () => {
    expect(findProjectTeamMemberOption('김소영(소이)')?.nickname).toBe('소이');
    expect(findProjectTeamMemberOption('박지연')).toBeUndefined();
  });

  it('buildTeamMemberDirectory 는 명부 레코드를 그대로 받는다', () => {
    const built = buildTeamMemberDirectory([
      { personId: 'psn-a', name: '노성진', nickname: '' },
      { personId: 'psn-b', name: '강에나', nickname: '하에나' },
    ]);
    expect(built.resolveId('노성진')).toBe('psn-a');
    expect(built.resolveId('강에나(하에나)')).toBe('psn-b');
    expect(built.resolveId('하에나')).toBe('psn-b');
    expect(built.resolveId('없는사람')).toBeNull();
  });
});
