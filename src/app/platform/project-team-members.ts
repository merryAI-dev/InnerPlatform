import type { ProjectTeamMemberAssignment } from '../data/types';

function toRate(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeProjectTeamMemberRow(member: ProjectTeamMemberAssignment): ProjectTeamMemberAssignment {
  return {
    memberName: String(member?.memberName || '').trim(),
    memberNickname: String(member?.memberNickname || '').trim(),
    role: String(member?.role || '').trim(),
    participationRate: toRate(member?.participationRate),
  };
}

export function normalizeProjectTeamMembers(
  members: ProjectTeamMemberAssignment[] | null | undefined,
): ProjectTeamMemberAssignment[] {
  return (Array.isArray(members) ? members : [])
    .map(normalizeProjectTeamMemberRow)
    .filter((member) => (
      member.memberName
      || member.memberNickname
      || member.role
      || member.participationRate > 0
    ));
}

export function normalizeProjectTeamMemberDraftRows(
  members: ProjectTeamMemberAssignment[] | null | undefined,
): ProjectTeamMemberAssignment[] {
  return (Array.isArray(members) ? members : []).map(normalizeProjectTeamMemberRow);
}

export function isProjectTeamMemberComplete(member: ProjectTeamMemberAssignment) {
  return Boolean(member.memberName && member.role);
}

export function hasIncompleteProjectTeamMembers(
  members: ProjectTeamMemberAssignment[] | null | undefined,
) {
  return normalizeProjectTeamMembers(members).some((member) => !isProjectTeamMemberComplete(member));
}

export function formatProjectTeamMemberLine(member: ProjectTeamMemberAssignment) {
  const identity = member.memberNickname
    ? `${member.memberName} (${member.memberNickname})`
    : member.memberName;
  return [
    identity,
    member.role,
    member.participationRate > 0 ? `${member.participationRate}%` : '',
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
