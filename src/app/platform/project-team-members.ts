import type { ProjectTeamMemberAssignment } from '../data/types';

function toRate(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function normalizeProjectTeamMembers(
  members: ProjectTeamMemberAssignment[] | null | undefined,
): ProjectTeamMemberAssignment[] {
  return (Array.isArray(members) ? members : [])
    .map((member) => ({
      memberName: String(member?.memberName || '').trim(),
      memberNickname: String(member?.memberNickname || '').trim(),
      role: String(member?.role || '').trim(),
      participationRate: toRate(member?.participationRate),
    }))
    .filter((member) => (
      member.memberName
      || member.memberNickname
      || member.role
      || member.participationRate > 0
    ));
}

export function isProjectTeamMemberComplete(member: ProjectTeamMemberAssignment) {
  return Boolean(member.memberName && member.role && member.participationRate > 0);
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
  return `${identity} / ${member.role} / ${member.participationRate}%`;
}

export function formatProjectTeamMembersSummary(
  members: ProjectTeamMemberAssignment[] | null | undefined,
  fallback = '',
  separator = ', ',
) {
  const completed = normalizeProjectTeamMembers(members).filter(isProjectTeamMemberComplete);
  if (completed.length === 0) {
    return String(fallback || '').trim() || '-';
  }
  return completed.map(formatProjectTeamMemberLine).join(separator);
}
