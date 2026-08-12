import {
  buildPersonDirectory,
  EMPTY_PERSON_DIRECTORY,
  type DirectoryPerson,
  type PersonDirectory,
} from '../platform/person-directory';
import type { OrgMember, Project } from './types';

function memberLabel(name: string, nickname: string): string {
  return nickname ? `${name}(${nickname})` : name;
}

export interface ProjectTeamMemberOption {
  value: string;
  name: string;
  nickname: string;
  label: string;
}

/**
 * 이름만 저장된 계정 문서의 별명을 채우기 위한 조회.
 *
 * 예전에는 코드에 박힌 직원 명부에서 가져왔다. 지금은 DB 인력 명부(persons)에서 온
 * directory 를 받는다. 명부가 아직 안 왔으면 빈 디렉터리로 동작한다 - 별명이 잠깐
 * 비어 보일 뿐, 후보 목록 자체는 계정(members)에서 나오므로 사람을 못 고르는 일은 없다.
 */
export function findProjectTeamMemberOption(
  value: string,
  directory: PersonDirectory = EMPTY_PERSON_DIRECTORY,
): ProjectTeamMemberOption | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  const parsed = splitMemberDisplayName(normalized);
  const nickname = directory.resolveNickname(normalized);
  if (!nickname && !parsed.nickname) return undefined;
  const resolved = parsed.nickname || nickname;
  return {
    value: parsed.name,
    name: parsed.name,
    nickname: resolved,
    label: memberLabel(parsed.name, resolved),
  };
}

export function splitMemberDisplayName(value: string): { name: string; nickname: string } {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { name: normalized, nickname: '' };
  return { name: match[1].trim(), nickname: match[2].trim() };
}

/** 인력 명부 레코드를 그대로 후보로 만든다. 배정에는 이름·별명만 저장되므로 계정이 없어도 고를 수 있다. */
function rosterOptions(roster: DirectoryPerson[]): ProjectTeamMemberOption[] {
  const options = new Map<string, ProjectTeamMemberOption>();
  roster.forEach((person) => {
    const name = String(person?.name || '').trim();
    if (!name) return;
    const nickname = String(person?.nickname || '').trim();
    const key = name.toLowerCase();
    if (options.has(key)) return;
    options.set(key, { value: name, name, nickname, label: memberLabel(name, nickname) });
  });
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, 'ko'));
}

/**
 * 팀원 후보 목록.
 *
 * 출처는 계정 원장(members)이다. 다만 계정 목록이 아직 안 왔거나 못 읽었을 때 빈 목록을
 * 돌려주면 사람이 팀원을 아예 못 고른다 - 포털 등록 화면은 members 가 [] 로 시작한다.
 * 그럴 때는 인력 명부(roster)로 후보를 만든다. 화면이 멈추는 것보다 낫다.
 */
export function buildProjectTeamMemberOptions(
  members: OrgMember[],
  roster: DirectoryPerson[] = [],
): ProjectTeamMemberOption[] {
  const directory = roster.length ? buildPersonDirectory(roster) : EMPTY_PERSON_DIRECTORY;
  if (!members.length) return rosterOptions(roster);

  const options = new Map<string, ProjectTeamMemberOption>();
  members.forEach((member) => {
    const status = String(member.status || '').trim().toUpperCase();
    if (status === 'INACTIVE' || status === 'DELETED') return;
    const parsed = splitMemberDisplayName(member.name || '');
    const displayName = String(member.nameKo || '').trim() || parsed.name;
    if (!String(member.uid || '').trim() || !displayName) return;
    const canonical = findProjectTeamMemberOption(displayName, directory);
    const nickname = String(member.nickname || '').trim() || parsed.nickname || canonical?.nickname || '';
    const key = displayName.toLowerCase();
    if (options.has(key)) return;
    options.set(key, {
      value: displayName,
      name: displayName,
      nickname,
      label: memberLabel(displayName, nickname),
    });
  });

  const liveOptions = [...options.values()]
    .sort((left, right) => left.label.localeCompare(right.label, 'ko'));
  // 계정이 전부 비활성이거나 uid 가 없어 한 명도 안 남는 경우도 같은 안전망을 쓴다.
  return liveOptions.length ? liveOptions : rosterOptions(roster);
}

/** 인력 명부 레코드로 디렉터리를 만든다. 호출부가 person-directory 를 직접 몰라도 되게. */
export function buildTeamMemberDirectory(
  people: Array<{ personId: string; name: string; nickname: string }>,
): PersonDirectory {
  return buildPersonDirectory(people);
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
      label: memberLabel(name, nickname),
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
  const label = memberLabel(name, nickname);
  return [
    { uid, name, nickname, email, label: `${label} · 기존 선택`, searchText: [name, nickname, email].filter(Boolean).join(' ').toLowerCase() },
    ...options,
  ];
}

export function regularizeProjectOwnerNames(project: Project, members: OrgMember[]): Project {
  const labels = new Map(buildOrgMemberPickerOptions(members).map((member) => [member.uid, member.label]));
  const registeredByName = labels.get(String(project.registeredById || '').trim());
  const managerName = labels.get(String(project.managerId || project.registeredById || '').trim());
  if (!registeredByName && !managerName) return project;
  return {
    ...project,
    ...(registeredByName ? { registeredByName } : {}),
    ...(managerName ? { managerName } : {}),
  };
}
