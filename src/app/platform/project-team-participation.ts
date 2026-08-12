import type {
  ParticipationEntry,
  Project,
  ProjectTeamMemberAssignment,
  SettlementSystemCode,
} from '../data/types';
import { normalizeSettlementSystemCode } from '../data/types';
import {
  compactIdentity,
  EMPTY_PERSON_DIRECTORY,
  parseDisplayName,
  type PersonDirectory,
} from './person-directory';
import {
  formatProjectTeamMemberLine,
  normalizeProjectTeamMembers,
} from './project-team-members';

function monthPart(value: unknown) {
  const text = String(value || '').trim();
  return text.length >= 7 ? text.slice(0, 7) : '';
}

function addKey(keys: Set<string>, value: unknown) {
  const key = compactIdentity(value);
  if (key) keys.add(key);
}

function entryIdentityKeys(entry: Pick<ParticipationEntry, 'memberName' | 'memberId'>) {
  const keys = new Set<string>();
  const parsed = parseDisplayName(entry.memberName);
  addKey(keys, parsed.full);
  addKey(keys, parsed.name);
  addKey(keys, parsed.nickname);
  if (parsed.name && parsed.nickname) {
    addKey(keys, `${parsed.name}(${parsed.nickname})`);
    addKey(keys, `${parsed.name} ${parsed.nickname}`);
  }
  if (!String(entry.memberId || '').startsWith('project-team:')) {
    addKey(keys, entry.memberId);
  }
  return keys;
}

function teamMemberIdentityKeys(member: ProjectTeamMemberAssignment) {
  const keys = new Set<string>();
  addKey(keys, member.memberName);
  addKey(keys, member.memberNickname);
  if (member.memberName && member.memberNickname) {
    addKey(keys, `${member.memberName}(${member.memberNickname})`);
    addKey(keys, `${member.memberName} ${member.memberNickname}`);
  }
  return keys;
}

function hasAnyIdentityKey(source: Set<string>, candidates: Set<string>) {
  for (const key of candidates) {
    if (source.has(key)) return true;
  }
  return false;
}

function resolveCanonicalMemberId(
  member: ProjectTeamMemberAssignment,
  fallbackKey: string,
  directory: PersonDirectory,
) {
  const display = member.memberNickname
    ? `${member.memberName}(${member.memberNickname})`
    : member.memberName;
  // 명부에서 못 찾아도 멈추지 않는다. 이름 기반 대체 키는 프로젝트가 달라도 같은 값이라
  // 한 사람의 배정이 흩어지지는 않는다 - 다만 표기가 흔들리면 갈라질 수 있다.
  return directory.resolveId(display) || `project-team:${fallbackKey}`;
}

export function resolveProjectTeamSettlementSystem(project: Project): SettlementSystemCode {
  const selectedSystem = normalizeSettlementSystemCode(project.settlementSystem);
  if (selectedSystem !== 'NONE') return selectedSystem;
  if (project.settlementType === 'TYPE5' || project.accountType === 'DEDICATED') {
    return 'E_NARA_DOUM';
  }
  return 'NONE';
}

/**
 * 한 사업의 배정을 참여율 항목으로 만든다.
 *
 * directory 는 이름으로 동일인을 찾는 근거다. 한 사업 안에서는 위의 identityKeys 로 이미
 * 중복이 걸러져 사람당 한 줄이므로, 단일 사업만 보는 화면은 넘기지 않아도 결과가 같다.
 * 여러 사업을 가로질러 합산할 때만(참여율 대시보드) 필요하다.
 */
export function buildProjectTeamParticipationEntries(
  project: Project,
  entries: ParticipationEntry[],
  directory: PersonDirectory = EMPTY_PERSON_DIRECTORY,
): ParticipationEntry[] {
  const projectEntries = entries.filter((entry) => (
    entry.projectId === project.id
    && entry.source !== 'PROJECT_TEAM_SYNC'
  ));
  const existingKeys = new Set<string>();
  projectEntries.forEach((entry) => {
    entryIdentityKeys(entry).forEach((key) => existingKeys.add(key));
  });
  const settlementSystem = resolveProjectTeamSettlementSystem(project);
  const teamEntries = normalizeProjectTeamMembers(project.teamMembersDetailed)
    .map((member, index): ParticipationEntry | null => {
      const identity = member.memberNickname
        ? `${member.memberName}(${member.memberNickname})`
        : member.memberName;
      const identityKey = compactIdentity(identity);
      const identityKeys = teamMemberIdentityKeys(member);
      if (!identityKey || hasAnyIdentityKey(existingKeys, identityKeys)) return null;
      identityKeys.forEach((key) => existingKeys.add(key));
      return {
        id: `project-team-${project.id}-${index}-${identityKey}`,
        memberId: resolveCanonicalMemberId(member, identityKey, directory),
        memberName: formatProjectTeamMemberLine({
          ...member,
          role: '',
          participationRate: 0,
          laborAllocationStartMonth: undefined,
          laborAllocationEndMonth: undefined,
        }),
        projectId: project.id,
        projectName: project.name,
        projectShortName: project.shortName || project.name,
        rate: member.participationRate,
        settlementSystem,
        clientOrg: project.clientOrg,
        periodStart: member.laborAllocationStartMonth || monthPart(project.contractStart),
        periodEnd: member.laborAllocationEndMonth || monthPart(project.contractEnd),
        isDocumentOnly: member.isDocumentOnly === true,
        note: member.role,
        source: 'PROJECT_TEAM_SYNC',
        projectTeamMemberKey: identityKey,
        updatedAt: project.updatedAt,
      };
    })
    .filter((entry): entry is ParticipationEntry => !!entry);

  return [...projectEntries, ...teamEntries]
    .sort((a, b) => String(a.memberName || '').localeCompare(String(b.memberName || ''), 'ko'));
}

export function buildAllProjectTeamParticipationEntries(
  projects: Project[],
  entries: ParticipationEntry[],
  directory: PersonDirectory = EMPTY_PERSON_DIRECTORY,
): ParticipationEntry[] {
  const projectIds = new Set(projects.map((project) => project.id));
  const outsideProjectEntries = entries.filter((entry) => (
    !projectIds.has(entry.projectId)
    && entry.source !== 'PROJECT_TEAM_SYNC'
  ));
  const currentProjectEntries = projects.flatMap((project) => (
    buildProjectTeamParticipationEntries(project, entries, directory)
  ));

  return [...outsideProjectEntries, ...currentProjectEntries];
}
