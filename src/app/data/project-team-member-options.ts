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

export function splitMemberDisplayName(value: string): { name: string; nickname: string } {
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
    const displayName = String(member.nameKo || '').trim() || parsed.name;
    if (!String(member.uid || '').trim() || !displayName) return;
    const canonical = findProjectTeamMemberOption(displayName);
    const nickname = String(member.nickname || '').trim() || parsed.nickname || canonical?.nickname || '';
    const key = displayName.toLowerCase();
    if (options.has(key)) return;
    options.set(key, {
      value: displayName,
      name: displayName,
      nickname,
      label: nickname ? `${displayName} (${nickname})` : displayName,
    });
  });

  const liveOptions = [...options.values()]
    .sort((left, right) => left.label.localeCompare(right.label, 'ko'));
  return liveOptions.length ? liveOptions : PROJECT_TEAM_MEMBER_OPTIONS;
}

export interface OrgMemberPickerOption {
  uid: string;
  name: string;
  nickname: string;
  email: string;
  label: string;
  searchText: string;
}

/**
 * Options for the pickers that choose a person (PM, 최종 결재자, 월 결산 조직장).
 *
 * Only an explicit INACTIVE or DELETED status removes someone. Requiring status to equal
 * ACTIVE hid the 15 members whose document carries no status field at all.
 */
export function buildOrgMemberPickerOptions(members: OrgMember[]): OrgMemberPickerOption[] {
  const byUid = new Map<string, OrgMemberPickerOption>();
  members.forEach((member) => {
    const uid = String(member.uid || '').trim();
    if (!uid || byUid.has(uid)) return;
    const status = String(member.status || '').trim().toUpperCase();
    if (status === 'INACTIVE' || status === 'DELETED') return;
    const email = String(member.email || '').trim();
    // nameKo and nickname belong to the roster. The combined `name` string is still written
    // by sign-in paths, so it is only parsed when the structured fields are absent.
    const parsed = splitMemberDisplayName(member.name || '');
    const name = String(member.nameKo || '').trim() || parsed.name || email || uid;
    const nickname = String(member.nickname || '').trim()
      || parsed.nickname
      || findProjectTeamMemberOption(name)?.nickname
      || '';
    byUid.set(uid, {
      uid,
      name,
      nickname,
      email,
      label: nickname ? `${name} (${nickname})` : name,
      searchText: [name, nickname, email].filter(Boolean).join(' ').toLowerCase(),
    });
  });
  return [...byUid.values()].sort((left, right) => left.label.localeCompare(right.label, 'ko'));
}

/**
 * Keeps a value that was saved earlier selectable even when that person no longer appears
 * in the current list, so opening an old project cannot silently drop its PM or approver.
 */
export function withSavedOrgMemberOption(
  options: OrgMemberPickerOption[],
  saved: { uid?: string | null; name?: string | null; email?: string | null },
): OrgMemberPickerOption[] {
  const uid = String(saved?.uid || '').trim();
  if (!uid || options.some((option) => option.uid === uid)) return options;
  const parsed = splitMemberDisplayName(String(saved?.name || ''));
  const email = String(saved?.email || '').trim();
  const name = parsed.name || email || uid;
  const nickname = parsed.nickname || findProjectTeamMemberOption(name)?.nickname || '';
  const label = nickname ? `${name} (${nickname})` : name;
  return [
    { uid, name, nickname, email, label: `${label} · 기존 선택`, searchText: [name, nickname, email].filter(Boolean).join(' ').toLowerCase() },
    ...options,
  ];
}
