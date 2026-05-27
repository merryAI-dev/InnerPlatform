import type {
  ParticipationEntry,
  Project,
  ProjectTeamMemberAssignment,
  SettlementSystemCode,
} from '../data/types';
import { EMPLOYEES } from '../data/participation-data';
import {
  formatProjectTeamMemberLine,
  normalizeProjectTeamMembers,
} from './project-team-members';

const employeeIdentityMap = new Map<string, string>();
EMPLOYEES.forEach((employee) => {
  [
    employee.realName,
    employee.nickname,
    employee.nickname ? `${employee.realName}(${employee.nickname})` : '',
    employee.nickname ? `${employee.realName} ${employee.nickname}` : '',
  ].forEach((value) => {
    const key = compactIdentity(value);
    if (key) employeeIdentityMap.set(key, employee.id);
  });
});

function compactIdentity(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()\s]/g, '')
    .trim();
}

function monthPart(value: unknown) {
  const text = String(value || '').trim();
  return text.length >= 7 ? text.slice(0, 7) : '';
}

function addKey(keys: Set<string>, value: unknown) {
  const key = compactIdentity(value);
  if (key) keys.add(key);
}

function parseDisplayName(value: unknown) {
  const text = String(value || '').trim();
  const match = text.match(/^(.+?)\s*\((.+?)\)\s*$/);
  return {
    full: text,
    name: match?.[1]?.trim() || text,
    nickname: match?.[2]?.trim() || '',
  };
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

function resolveCanonicalMemberId(member: ProjectTeamMemberAssignment, fallbackKey: string) {
  const keys = teamMemberIdentityKeys(member);
  for (const key of keys) {
    const employeeId = employeeIdentityMap.get(key);
    if (employeeId) return employeeId;
  }
  return `project-team:${fallbackKey}`;
}

export function resolveProjectTeamSettlementSystem(project: Project): SettlementSystemCode {
  if (project.settlementType === 'TYPE5' || project.accountType === 'DEDICATED') {
    return 'E_NARA_DOUM';
  }
  return 'NONE';
}

export function buildProjectTeamParticipationEntries(
  project: Project,
  entries: ParticipationEntry[],
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
        memberId: resolveCanonicalMemberId(member, identityKey),
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
        isDocumentOnly: false,
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
): ParticipationEntry[] {
  const projectIds = new Set(projects.map((project) => project.id));
  const outsideProjectEntries = entries.filter((entry) => (
    !projectIds.has(entry.projectId)
    && entry.source !== 'PROJECT_TEAM_SYNC'
  ));
  const currentProjectEntries = projects.flatMap((project) => (
    buildProjectTeamParticipationEntries(project, entries)
  ));

  return [...outsideProjectEntries, ...currentProjectEntries];
}
