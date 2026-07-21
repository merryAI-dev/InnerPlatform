import { EMPLOYEES } from './participation-data';
import type { OrgMember } from './types';

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

function splitMemberDisplayName(value: string): { name: string; nickname: string } {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { name: normalized, nickname: '' };
  return { name: match[1].trim(), nickname: match[2].trim() };
}

export function buildProjectTeamMemberOptions(members: OrgMember[]): ProjectTeamMemberOption[] {
  if (!members.length) return PROJECT_TEAM_MEMBER_OPTIONS;

  const options = new Map<string, ProjectTeamMemberOption>();
  members.forEach((member) => {
    const status = String(member.status || '').trim().toUpperCase();
    if (status === 'INACTIVE' || status === 'DELETED') return;
    const parsed = splitMemberDisplayName(member.name || '');
    if (!String(member.uid || '').trim() || !parsed.name) return;
    const canonical = findProjectTeamMemberOption(parsed.name);
    const nickname = parsed.nickname || canonical?.nickname || '';
    const key = parsed.name.toLowerCase();
    if (options.has(key)) return;
    options.set(key, {
      value: parsed.name,
      name: parsed.name,
      nickname,
      label: nickname ? `${parsed.name} (${nickname})` : parsed.name,
    });
  });

  const liveOptions = [...options.values()]
    .sort((left, right) => left.label.localeCompare(right.label, 'ko'));
  return liveOptions.length ? liveOptions : PROJECT_TEAM_MEMBER_OPTIONS;
}
