import { describe, expect, it } from 'vitest';
import { EMPLOYEES } from './participation-data';
import { findProjectTeamMemberOption, PROJECT_TEAM_MEMBER_OPTIONS } from './project-team-member-options';

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
});
