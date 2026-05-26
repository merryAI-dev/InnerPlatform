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

const PROJECT_TEAM_MEMBER_SEARCH_MAP = new Map<string, ProjectTeamMemberOption>();

for (const option of PROJECT_TEAM_MEMBER_OPTIONS) {
  for (const key of [option.value, option.name, option.nickname, option.label]) {
    const normalized = key.trim().toLowerCase();
    if (normalized) PROJECT_TEAM_MEMBER_SEARCH_MAP.set(normalized, option);
  }
}

export function findProjectTeamMemberOption(value: string): ProjectTeamMemberOption | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  return PROJECT_TEAM_MEMBER_SEARCH_MAP.get(normalized);
}
