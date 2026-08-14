import type { ProjectTeamMemberAssignment } from '../data/types';

export const PROJECT_TEAM_MEMBER_ROLES = [
  '총괄책임자',
  '실무책임자',
  '운영매니저',
  '정산지원',
] as const;

export const RETIRED_PROJECT_TEAM_MEMBER_ROLES = ['사업 최종 책임자'] as const;

function toRate(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function toMonth(value: unknown) {
  const normalized = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : '';
}

export function parseProjectTeamMemberIdentityInput(value: string) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  const match = normalized.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
  if (!match) {
    return {
      memberName: normalized,
      memberNickname: '',
    };
  }
  return {
    memberName: match[1].trim(),
    memberNickname: match[2].trim(),
  };
}

function normalizeProjectTeamMemberRow(
  member: ProjectTeamMemberAssignment,
  options: { preserveInputMode?: boolean } = {},
): ProjectTeamMemberAssignment {
  const normalized: ProjectTeamMemberAssignment = {
    memberName: String(member?.memberName || '').trim(),
    memberNickname: String(member?.memberNickname || '').trim(),
    role: String(member?.role || '').trim(),
    participationRate: toRate(member?.participationRate),
  };
  const personId = String(member?.personId || '').trim();
  if (personId) normalized.personId = personId;
  if (typeof member?.isDocumentOnly === 'boolean') {
    normalized.isDocumentOnly = member.isDocumentOnly;
  } else if (normalized.memberName && (
    PROJECT_TEAM_MEMBER_ROLES.includes(normalized.role as typeof PROJECT_TEAM_MEMBER_ROLES[number])
    || RETIRED_PROJECT_TEAM_MEMBER_ROLES.includes(normalized.role as typeof RETIRED_PROJECT_TEAM_MEMBER_ROLES[number])
  )) {
    normalized.isDocumentOnly = false;
  }
  const laborAllocationStartMonth = toMonth(member?.laborAllocationStartMonth);
  const laborAllocationEndMonth = toMonth(member?.laborAllocationEndMonth);
  if (laborAllocationStartMonth) normalized.laborAllocationStartMonth = laborAllocationStartMonth;
  if (laborAllocationEndMonth) normalized.laborAllocationEndMonth = laborAllocationEndMonth;
  if (options.preserveInputMode && member?.inputMode === 'manual') {
    normalized.inputMode = 'manual';
    if (typeof member?.identityInput === 'string') {
      normalized.identityInput = member.identityInput;
    }
  }
  return normalized;
}

export function normalizeProjectTeamMembers(
  members: ProjectTeamMemberAssignment[] | null | undefined,
): ProjectTeamMemberAssignment[] {
  return (Array.isArray(members) ? members : [])
    .map((member) => normalizeProjectTeamMemberRow(member))
    .filter((member) => (
      member.memberName
      || member.memberNickname
      || member.role
      || member.participationRate > 0
      || member.isDocumentOnly === true
      || member.laborAllocationStartMonth
      || member.laborAllocationEndMonth
    ));
}

export function normalizeProjectTeamMemberDraftRows(
  members: ProjectTeamMemberAssignment[] | null | undefined,
): ProjectTeamMemberAssignment[] {
  return (Array.isArray(members) ? members : [])
    .map((member) => normalizeProjectTeamMemberRow(member, { preserveInputMode: true }));
}

export function isProjectTeamMemberComplete(member: ProjectTeamMemberAssignment) {
  return Boolean(
    member.memberName
    && (
      PROJECT_TEAM_MEMBER_ROLES.includes(member.role as typeof PROJECT_TEAM_MEMBER_ROLES[number])
      || RETIRED_PROJECT_TEAM_MEMBER_ROLES.includes(member.role as typeof RETIRED_PROJECT_TEAM_MEMBER_ROLES[number])
    )
  );
}

export function hasIncompleteProjectTeamMembers(
  members: ProjectTeamMemberAssignment[] | null | undefined,
) {
  return normalizeProjectTeamMembers(members).some((member) => !isProjectTeamMemberComplete(member));
}

export function hasProjectOperatingManager(
  members: ProjectTeamMemberAssignment[] | null | undefined,
) {
  return normalizeProjectTeamMembers(members).some((member) => (
    member.role === '운영매니저'
  ));
}

export function projectTeamMembersForWrite(
  members: ProjectTeamMemberAssignment[] | null | undefined,
) {
  return normalizeProjectTeamMembers(members);
}

export function isProjectSettlementSupportMember(
  member: Pick<ProjectTeamMemberAssignment, 'memberName' | 'memberNickname'>,
) {
  const name = String(member.memberName || '').trim();
  const nickname = String(member.memberNickname || '').trim();
  return name === '송성미' || name === '최지윤' || nickname === '도담' || nickname === '써니';
}

export function hasInvalidProjectTeamMemberLaborPeriod(
  members: ProjectTeamMemberAssignment[] | null | undefined,
) {
  return (Array.isArray(members) ? members : []).some((member) => {
    const start = String(member?.laborAllocationStartMonth || '').trim();
    const end = String(member?.laborAllocationEndMonth || '').trim();
    if ((start && !toMonth(start)) || (end && !toMonth(end))) return true;
    return Boolean(start && end && start > end);
  });
}

export function formatProjectTeamMemberLine(member: ProjectTeamMemberAssignment) {
  const identity = member.memberNickname
    ? `${member.memberName} (${member.memberNickname})`
    : member.memberName;
  const period = member.laborAllocationStartMonth || member.laborAllocationEndMonth
    ? `${member.laborAllocationStartMonth || '-'}~${member.laborAllocationEndMonth || '-'}`
    : '';
  return [
    identity,
    member.role,
    member.participationRate > 0 ? `${member.participationRate}%` : '',
    member.isDocumentOnly === true ? '서류상 인력' : member.isDocumentOnly === false ? '실제 참여' : '',
    period ? `인건비 ${period}` : '',
  ].filter(Boolean).join(' / ');
}

export function formatProjectTeamMembersSummary(
  members: ProjectTeamMemberAssignment[] | null | undefined,
  fallback = '',
  separator = ', ',
) {
  const normalized = normalizeProjectTeamMembers(members);
  if (normalized.length === 0) {
    return String(fallback || '').trim() || '-';
  }
  return normalized.map(formatProjectTeamMemberLine).join(separator);
}
