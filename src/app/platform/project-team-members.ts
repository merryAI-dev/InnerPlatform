import type { ProjectTeamMemberAssignment } from '../data/types';

export const PROJECT_TEAM_MEMBER_ROLES = [
  '총괄책임자',
  '실무책임자',
  '운영매니저',
  '정산지원',
] as const;

export const RETIRED_PROJECT_TEAM_MEMBER_ROLES = ['사업 최종 책임자'] as const;

interface ParticipationSheetPreviewForProjectTeam {
  months: string[];
  rows: Array<{
    nickname: string;
    name: string;
    role: string;
    stintStart: string;
    stintEnd: string;
    baseRate: number | null;
    personId: string;
    linkState: 'LINKED' | 'PENDING_LINK' | 'PLACEHOLDER';
    monthlyRates: Record<string, number>;
  }>;
}

interface ParticipationSheetSyncDraft {
  registrationRequirementsVersion: 1 | 2;
  participationSheetLink: string;
  contractStart: string;
  contractEnd: string;
  teamMembersDetailed: ProjectTeamMemberAssignment[];
}

function toRate(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function toMonth(value: unknown) {
  const normalized = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : '';
}

function normalizeMonthlyRates(value: unknown): Record<string, number | null> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalized: Record<string, number | null> = {};
  Object.entries(value).forEach(([rawMonth, rawRate]) => {
    const month = toMonth(rawMonth);
    if (!month) return;
    if (rawRate === null) {
      normalized[month] = null;
      return;
    }
    if (typeof rawRate === 'number' && Number.isFinite(rawRate)) {
      normalized[month] = rawRate;
    }
  });
  return normalized;
}

export function mapParticipationSheetPreviewToProjectTeamMembers(
  preview: ParticipationSheetPreviewForProjectTeam,
): ProjectTeamMemberAssignment[] {
  const months = [...new Set((Array.isArray(preview.months) ? preview.months : [])
    .map(toMonth)
    .filter(Boolean))];
  return (Array.isArray(preview.rows) ? preview.rows : [])
    .filter((row) => row.linkState !== 'PLACEHOLDER')
    .map((row) => {
      const stintStart = toMonth(row.stintStart);
      const stintEnd = toMonth(row.stintEnd);
      const monthlyRates = Object.fromEntries(months
        .filter((month) => Boolean(stintStart)
          && month >= stintStart
          && (!stintEnd || month <= stintEnd))
        .map((month) => [
          month,
          Object.prototype.hasOwnProperty.call(row.monthlyRates || {}, month)
            ? row.monthlyRates[month]
            : null,
        ]));
      return {
        ...(String(row.personId || '').trim() ? { personId: String(row.personId).trim() } : {}),
        memberName: String(row.name || '').trim(),
        memberNickname: String(row.nickname || '').trim(),
        role: String(row.role || '').trim(),
        participationRate: row.baseRate ?? 0,
        ...(stintStart ? { laborAllocationStartMonth: stintStart } : {}),
        ...(stintEnd ? { laborAllocationEndMonth: stintEnd } : {}),
        monthlyRates,
      };
    });
}

export function participationSheetSyncSignature(input: {
  sheetLink: string;
  contractStart: string;
  contractEnd: string;
  teamMembersDetailed: ProjectTeamMemberAssignment[];
}) {
  const roster = normalizeProjectTeamMembers(input.teamMembersDetailed).map((member) => ({
    personId: member.personId || '',
    memberName: member.memberName,
    memberNickname: member.memberNickname,
    role: member.role,
    participationRate: member.participationRate,
    laborAllocationStartMonth: member.laborAllocationStartMonth || '',
    laborAllocationEndMonth: member.laborAllocationEndMonth || '',
    ...(Object.prototype.hasOwnProperty.call(member, 'monthlyRates') ? {
      monthlyRates: Object.fromEntries(Object.entries(member.monthlyRates || {}).sort(([left], [right]) => left.localeCompare(right))),
    } : {}),
  }));
  return JSON.stringify([
    String(input.sheetLink || '').trim(),
    String(input.contractStart || '').trim(),
    String(input.contractEnd || '').trim(),
    roster,
  ]);
}

export function participationSheetLinkRequired(input: {
  draft: ParticipationSheetSyncDraft;
  initialDraft: ParticipationSheetSyncDraft;
  allowLegacyNoLink: boolean;
}) {
  if (!input.allowLegacyNoLink) return true;
  if (input.draft.registrationRequirementsVersion !== input.initialDraft.registrationRequirementsVersion) return true;
  if (input.initialDraft.participationSheetLink.trim()) return true;
  const signatureOf = (draft: ParticipationSheetSyncDraft) => participationSheetSyncSignature({
    sheetLink: draft.participationSheetLink,
    contractStart: draft.contractStart,
    contractEnd: draft.contractEnd,
    teamMembersDetailed: draft.teamMembersDetailed,
  });
  return signatureOf(input.draft) !== signatureOf(input.initialDraft);
}

export function participationSheetSyncIssue(input: {
  draft: ParticipationSheetSyncDraft;
  initialDraft: ParticipationSheetSyncDraft;
  syncedSignature: string | null;
  trustInitialPersistedSheetState?: boolean;
}): string | null {
  const current = {
    sheetLink: input.draft.participationSheetLink,
    contractStart: input.draft.contractStart,
    contractEnd: input.draft.contractEnd,
    teamMembersDetailed: input.draft.teamMembersDetailed,
  };
  if (!current.sheetLink.trim() || !current.contractStart.trim() || !current.contractEnd.trim()) return null;
  const currentSignature = participationSheetSyncSignature(current);
  if (input.syncedSignature === currentSignature) return null;

  const initialSignature = participationSheetSyncSignature({
    sheetLink: input.initialDraft.participationSheetLink,
    contractStart: input.initialDraft.contractStart,
    contractEnd: input.initialDraft.contractEnd,
    teamMembersDetailed: input.initialDraft.teamMembersDetailed,
  });
  const initialMembers = Array.isArray(input.initialDraft.teamMembersDetailed)
    ? input.initialDraft.teamMembersDetailed
    : [];
  const hasPersistedSheetState = Boolean(input.initialDraft.participationSheetLink.trim())
    && (
      initialMembers.length === 0
      || initialMembers.every((member) => Object.prototype.hasOwnProperty.call(member, 'monthlyRates'))
    );
  if (
    currentSignature === initialSignature
    && hasPersistedSheetState
    && input.trustInitialPersistedSheetState !== false
  ) return null;
  return '참여율 시트를 다시 연동해 주세요.';
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
  const monthlyRates = normalizeMonthlyRates(member?.monthlyRates);
  if (monthlyRates) normalized.monthlyRates = monthlyRates;
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
