import { describe, expect, it } from 'vitest';
import { EMPLOYEES } from './participation-data';
import { PROJECT_TEAM_MEMBER_OPTIONS } from './project-team-member-options';

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
});
