import { describe, expect, it } from 'vitest';
import { EMPLOYEES } from './participation-data';
import {
  buildProjectTeamMemberOptions,
  findProjectTeamMemberOption,
  PROJECT_TEAM_MEMBER_OPTIONS,
} from './project-team-member-options';

describe('project-team-member-options', () => {
  it('stays in parity with the canonical employee list', () => {
    expect(PROJECT_TEAM_MEMBER_OPTIONS.map((option) => option.name)).toEqual(
      EMPLOYEES.map((employee) => employee.realName),
    );
  });

  it('includes employees used by participation rollups', () => {
    expect(PROJECT_TEAM_MEMBER_OPTIONS.map((option) => option.name)).toEqual(
      expect.arrayContaining(['김원희', '임성준', '박준형', '노성진', '김민주']),
    );
  });

  it('includes deployed PM identities missing from the previous static picker', () => {
    expect(PROJECT_TEAM_MEMBER_OPTIONS.map((option) => option.label)).toEqual(
      expect.arrayContaining(['박지연 (느티)', '김소영 (소이)', '최새롬 (노리)']),
    );
  });

  it('finds options by legal name, nickname, or display label', () => {
    expect(findProjectTeamMemberOption('박지연')?.nickname).toBe('느티');
    expect(findProjectTeamMemberOption('느티')?.name).toBe('박지연');
    expect(findProjectTeamMemberOption('김소영 (소이)')?.name).toBe('김소영');
  });

  it('builds the picker from the live member directory and excludes inactive records', () => {
    const options = buildProjectTeamMemberOptions([
      { uid: 'u-boram', name: '변민욱', email: 'boram@mysc.co.kr', role: 'pm', status: 'ACTIVE' },
      { uid: 'u-new', name: '신규구성원(새별)', email: 'new@mysc.co.kr', role: 'viewer', status: 'ACTIVE' },
      { uid: 'u-left', name: '퇴사자', email: 'left@mysc.co.kr', role: 'viewer', status: 'INACTIVE' },
    ]);

    expect(options).toEqual([
      expect.objectContaining({ name: '변민욱', nickname: '보람', label: '변민욱 (보람)' }),
      expect.objectContaining({ name: '신규구성원', nickname: '새별', label: '신규구성원 (새별)' }),
    ]);
    expect(options.map((option) => option.name)).not.toContain('퇴사자');
    expect(options.map((option) => option.name)).not.toContain('박지연');
  });

  it('keeps the canonical fallback for offline harnesses without a member directory', () => {
    expect(buildProjectTeamMemberOptions([])).toBe(PROJECT_TEAM_MEMBER_OPTIONS);
  });
});
