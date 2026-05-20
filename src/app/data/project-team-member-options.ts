import { EMPLOYEES } from './participation-data';

export interface ProjectTeamMemberOption {
  value: string;
  name: string;
  nickname: string;
  label: string;
}

export const PROJECT_TEAM_MEMBER_OPTIONS: ProjectTeamMemberOption[] = EMPLOYEES
  .map(({ realName, nickname }) => {
    const name = realName.trim();
    const displayNickname = nickname.trim();
    return {
      value: name,
      name,
      nickname: displayNickname,
      label: displayNickname ? `${name} (${displayNickname})` : name,
    };
  });

export const PROJECT_TEAM_MEMBER_OPTION_MAP = Object.fromEntries(
  PROJECT_TEAM_MEMBER_OPTIONS.map((option) => [option.value, option]),
) as Record<string, ProjectTeamMemberOption>;
