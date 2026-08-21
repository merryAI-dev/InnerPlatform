import { describe, expect, it } from 'vitest';
import type { ParticipationSheetPreview } from '../lib/platform-bff-client';
import type { ProjectTeamMemberAssignment } from '../data/types';
import {
  formatProjectTeamMembersSummary,
  hasInvalidProjectTeamMemberLaborPeriod,
  hasIncompleteProjectTeamMembers,
  hasProjectOperatingManager,
  normalizeProjectTeamMemberDraftRows,
  normalizeProjectTeamMembers,
  parseProjectTeamMemberIdentityInput,
  PROJECT_TEAM_MEMBER_ROLES,
  projectTeamMembersForWrite,
} from './project-team-members';

type ParticipationSheetPreviewMapper = (
  preview: ParticipationSheetPreview,
) => ProjectTeamMemberAssignment[];

type ParticipationSheetSyncSignature = (input: {
  sheetLink: string;
  contractStart: string;
  contractEnd: string;
  teamMembersDetailed: ProjectTeamMemberAssignment[];
}) => string;

type ParticipationSheetSyncIssue = (input: {
  draft: {
    registrationRequirementsVersion: 1 | 2;
    participationSheetLink: string;
    contractStart: string;
    contractEnd: string;
    teamMembersDetailed: ProjectTeamMemberAssignment[];
  };
  initialDraft: {
    registrationRequirementsVersion: 1 | 2;
    participationSheetLink: string;
    contractStart: string;
    contractEnd: string;
    teamMembersDetailed: ProjectTeamMemberAssignment[];
  };
  syncedSignature: string | null;
  trustInitialPersistedSheetState?: boolean;
}) => string | null;

type ParticipationSheetLinkRequired = (input: {
  draft: Parameters<ParticipationSheetSyncIssue>[0]['draft'];
  initialDraft: Parameters<ParticipationSheetSyncIssue>[0]['initialDraft'];
  allowLegacyNoLink: boolean;
}) => boolean;

async function loadPreviewMapper() {
  const module = await import('./project-team-members') as typeof import('./project-team-members') & {
    mapParticipationSheetPreviewToProjectTeamMembers?: ParticipationSheetPreviewMapper;
  };
  expect(module.mapParticipationSheetPreviewToProjectTeamMembers).toBeTypeOf('function');
  return module.mapParticipationSheetPreviewToProjectTeamMembers as ParticipationSheetPreviewMapper;
}

async function loadParticipationSheetSyncHelpers() {
  const module = await import('./project-team-members') as typeof import('./project-team-members') & {
    participationSheetSyncSignature?: ParticipationSheetSyncSignature;
    participationSheetSyncIssue?: ParticipationSheetSyncIssue;
    participationSheetLinkRequired?: ParticipationSheetLinkRequired;
  };
  expect(module.participationSheetSyncSignature).toBeTypeOf('function');
  expect(module.participationSheetSyncIssue).toBeTypeOf('function');
  expect(module.participationSheetLinkRequired).toBeTypeOf('function');
  return {
    signature: module.participationSheetSyncSignature as ParticipationSheetSyncSignature,
    syncIssue: module.participationSheetSyncIssue as ParticipationSheetSyncIssue,
    linkRequired: module.participationSheetLinkRequired as ParticipationSheetLinkRequired,
  };
}

describe('project-team-members', () => {
  it('formats completed team members into a readable summary', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60, laborAllocationStartMonth: '2026-03', laborAllocationEndMonth: '2026-08' },
      { memberName: '변민욱', memberNickname: '보람', role: '운영', participationRate: 40 },
    ]);

    expect(result).toContain('김다은 (데이나) / PM / 60% / 인건비 2026-03~2026-08');
    expect(result).toContain('변민욱 (보람) / 운영 / 40%');
  });

  it('formats team member without participation rate (omits rate)', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 0 },
    ]);

    expect(result).toBe('김다은 (데이나) / PM');
  });

  it('formats saved partial team rows instead of hiding them from review surfaces', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: '', participationRate: 0 },
    ]);

    expect(result).toBe('김다은 (데이나)');
  });

  it('keeps empty draft rows while editing before save normalization', () => {
    expect(normalizeProjectTeamMemberDraftRows([
      { memberName: '', memberNickname: '', role: '', participationRate: 0 },
    ])).toEqual([
      { memberName: '', memberNickname: '', role: '', participationRate: 0 },
    ]);
    expect(normalizeProjectTeamMembers([
      { memberName: '', memberNickname: '', role: '', participationRate: 0, laborAllocationStartMonth: '2026-04' },
    ])).toEqual([
      { memberName: '', memberNickname: '', role: '', participationRate: 0, laborAllocationStartMonth: '2026-04' },
    ]);
    expect(normalizeProjectTeamMembers([
      { memberName: '', memberNickname: '', role: '', participationRate: 0, laborAllocationStartMonth: '2026-4' },
    ])).toEqual([]);
  });

  it('preserves explicit monthly null, zero, and changed rates during normalization', () => {
    const member: ProjectTeamMemberAssignment = {
      personId: 'person-1',
      memberName: '유자인',
      memberNickname: '유자',
      role: '',
      participationRate: 20,
      laborAllocationStartMonth: '2026-11',
      laborAllocationEndMonth: '2027-02',
      monthlyRates: {
        '2026-11': 20,
        '2026-12': 0,
        '2027-01': null,
        '2027-02': 5,
      },
    };

    expect(normalizeProjectTeamMembers([member])).toEqual([member]);
    expect(normalizeProjectTeamMemberDraftRows([member])).toEqual([member]);
    expect(projectTeamMembersForWrite([member])).toEqual([member]);
  });

  it('maps a multi-year preview into active stint months without collapsing blank and zero', async () => {
    const mapPreview = await loadPreviewMapper();
    const preview: ParticipationSheetPreview = {
      projectId: '',
      projectName: '',
      sheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      checkedAt: '2026-08-21T00:00:00.000Z',
      ok: true,
      summary: null,
      blocking: [],
      months: ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'],
      rows: [{
        rowIndex: 4,
        nickname: '메씨리',
        name: '이예지',
        role: '',
        stintStart: '2026-11',
        stintEnd: '2027-02',
        baseRate: 30,
        personId: '',
        linkState: 'PENDING_LINK',
        monthlyRates: {
          '2026-11': 30,
          '2026-12': 0,
          '2027-02': 20,
        },
      }],
      missing: [{ rowIndex: 4, label: '이예지', month: '2027-01' }],
      candidates: [{ key: '이예지', name: '이예지', nickname: '메씨리', rowIndexes: [4], monthCount: 3 }],
    };

    expect(mapPreview(preview)).toEqual([{
      memberName: '이예지',
      memberNickname: '메씨리',
      role: '',
      participationRate: 30,
      laborAllocationStartMonth: '2026-11',
      laborAllocationEndMonth: '2027-02',
      monthlyRates: {
        '2026-11': 30,
        '2026-12': 0,
        '2027-01': null,
        '2027-02': 20,
      },
    }]);
  });

  it('keeps all 123 contract months in the saved roster while the UI slices them by year', async () => {
    const mapPreview = await loadPreviewMapper();
    const months = Array.from({ length: 123 }, (_, index) => {
      const absoluteMonth = 2025 * 12 + 3 + index;
      return `${Math.floor(absoluteMonth / 12)}-${String((absoluteMonth % 12) + 1).padStart(2, '0')}`;
    });
    const preview = {
      projectId: '', projectName: '', sheetLink: 'https://docs.google.com/spreadsheets/d/long/edit',
      checkedAt: '2026-08-21T00:00:00.000Z', ok: true, summary: null, blocking: [], months,
      rows: [{
        rowIndex: 0, nickname: '에이블', name: '김정태', role: '',
        stintStart: months[0], stintEnd: months.at(-1) || '', baseRate: 20,
        personId: 'person-able', linkState: 'LINKED' as const,
        monthlyRates: { [months[0]]: 20, [months[120]]: 0, [months[122]]: 5 },
      }],
      missing: [], candidates: [],
    } satisfies ParticipationSheetPreview;

    const [member] = mapPreview(preview);

    expect(Object.keys(member.monthlyRates || {})).toHaveLength(123);
    expect(member.monthlyRates).toMatchObject({
      '2025-04': 20,
      '2035-04': 0,
      '2035-05': null,
      '2035-06': 5,
    });
  });

  it('excludes placeholder rows while keeping People-link candidates', async () => {
    const mapPreview = await loadPreviewMapper();
    const preview = {
      projectId: '',
      projectName: '',
      sheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      checkedAt: '2026-08-21T00:00:00.000Z',
      ok: true,
      summary: null,
      blocking: [],
      months: ['2026-01'],
      rows: [
        {
          rowIndex: 0,
          nickname: '미정-1',
          name: '',
          role: '',
          stintStart: '2026-01',
          stintEnd: '2026-01',
          baseRate: null,
          personId: '',
          linkState: 'PLACEHOLDER',
          monthlyRates: {} as Record<string, number>,
        },
        {
          rowIndex: 1,
          nickname: '테일러',
          name: '김혜령',
          role: '연구',
          stintStart: '2026-01',
          stintEnd: '2026-01',
          baseRate: 30,
          personId: '',
          linkState: 'PENDING_LINK',
          monthlyRates: { '2026-01': 30 },
        },
      ],
      missing: [],
      candidates: [{ key: '김혜령', name: '김혜령', nickname: '테일러', rowIndexes: [1], monthCount: 1 }],
    } satisfies ParticipationSheetPreview;

    expect(mapPreview(preview)).toEqual([{
      memberName: '김혜령',
      memberNickname: '테일러',
      role: '연구',
      participationRate: 30,
      laborAllocationStartMonth: '2026-01',
      laborAllocationEndMonth: '2026-01',
      monthlyRates: { '2026-01': 30 },
    }]);
  });

  it('accepts the exact current sheet signature only after a successful preview', async () => {
    const { signature, syncIssue } = await loadParticipationSheetSyncHelpers();
    const initialDraft = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: '',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [],
    };
    const draft = {
      ...initialDraft,
      participationSheetLink: ' https://docs.google.com/spreadsheets/d/sheet-a/edit ',
    };
    const syncedSignature = signature({
      sheetLink: draft.participationSheetLink,
      contractStart: draft.contractStart,
      contractEnd: draft.contractEnd,
      teamMembersDetailed: draft.teamMembersDetailed,
    });

    expect(syncIssue({ draft, initialDraft, syncedSignature })).toBeNull();
  });

  it.each([
    ['sheet link', { participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-b/edit' }],
    ['contract start', { contractStart: '2026-02-01' }],
    ['contract end', { contractEnd: '2027-02-01' }],
  ])('requires another preview when the %s changes after sync', async (_label, change) => {
    const { signature, syncIssue } = await loadParticipationSheetSyncHelpers();
    const initialDraft = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [],
    };
    const syncedSignature = signature({
      sheetLink: initialDraft.participationSheetLink,
      contractStart: initialDraft.contractStart,
      contractEnd: initialDraft.contractEnd,
      teamMembersDetailed: initialDraft.teamMembersDetailed,
    });
    const draft = { ...initialDraft, ...change };

    expect(syncIssue({ draft, initialDraft, syncedSignature })).toContain('다시 연동');
  });

  it('does not accept a different preview roster after the sheet link is changed back to its initial value', async () => {
    const { signature, syncIssue } = await loadParticipationSheetSyncHelpers();
    const initialMember: ProjectTeamMemberAssignment = {
      personId: 'person-a',
      memberName: '김정태',
      memberNickname: '에이블',
      role: '',
      participationRate: 20,
      laborAllocationStartMonth: '2026-01',
      monthlyRates: { '2026-01': 20 },
    };
    const otherMember: ProjectTeamMemberAssignment = {
      personId: 'person-b',
      memberName: '이예지',
      memberNickname: '메씨리',
      role: '',
      participationRate: 30,
      laborAllocationStartMonth: '2026-01',
      monthlyRates: { '2026-01': 30 },
    };
    const initialDraft = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      contractStart: '2026-01-01',
      contractEnd: '2026-12-31',
      teamMembersDetailed: [initialMember],
    };
    const sheetBDraft = {
      ...initialDraft,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-b/edit',
      teamMembersDetailed: [otherMember],
    };
    const sheetBSignature = signature({
      sheetLink: sheetBDraft.participationSheetLink,
      contractStart: sheetBDraft.contractStart,
      contractEnd: sheetBDraft.contractEnd,
      teamMembersDetailed: sheetBDraft.teamMembersDetailed,
    });
    const revertedLinkDraft = {
      ...sheetBDraft,
      participationSheetLink: initialDraft.participationSheetLink,
    };

    expect(syncIssue({ draft: revertedLinkDraft, initialDraft, syncedSignature: sheetBSignature }))
      .toContain('다시 연동');
  });

  it('blocks a new V2 draft and a legacy saved roster without monthly data until preview succeeds', async () => {
    const { syncIssue } = await loadParticipationSheetSyncHelpers();
    const newDraft = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [],
    };
    const oldDraft = {
      ...newDraft,
      teamMembersDetailed: [{
        memberName: '김정태',
        memberNickname: '에이블',
        role: '총괄책임자',
        participationRate: 20,
      }],
    };

    expect(syncIssue({ draft: newDraft, initialDraft: { ...newDraft, participationSheetLink: '' }, syncedSignature: null }))
      .toContain('다시 연동');
    expect(syncIssue({ draft: oldDraft, initialDraft: oldDraft, syncedSignature: null }))
      .toContain('다시 연동');
  });

  it('lets an unchanged saved V2 roster with monthly data be edited without re-reading the sheet', async () => {
    const { syncIssue } = await loadParticipationSheetSyncHelpers();
    const savedDraft = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [{
        memberName: '유자인',
        memberNickname: '유자',
        role: '',
        participationRate: 20,
        laborAllocationStartMonth: '2026-11',
        laborAllocationEndMonth: '2027-02',
        monthlyRates: {
          '2026-11': 20,
          '2026-12': 0,
          '2027-01': null,
          '2027-02': 5,
        },
      }],
    };

    expect(syncIssue({ draft: savedDraft, initialDraft: savedDraft, syncedSignature: null })).toBeNull();
  });

  it('lets an unchanged saved V2 sheet with placeholder rows only be edited without re-reading the sheet', async () => {
    const { syncIssue } = await loadParticipationSheetSyncHelpers();
    const savedDraft = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [],
    };

    expect(syncIssue({ draft: savedDraft, initialDraft: savedDraft, syncedSignature: null })).toBeNull();
  });

  it('grandfathers only an unchanged existing project that predates participation sheet links', async () => {
    const { linkRequired } = await loadParticipationSheetSyncHelpers();
    const existingWithoutLink = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: '',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [{
        memberName: '김정태', memberNickname: '에이블', role: '운영매니저', participationRate: 20,
      }],
    };

    expect(linkRequired({
      draft: existingWithoutLink,
      initialDraft: existingWithoutLink,
      allowLegacyNoLink: true,
    })).toBe(false);
    expect(linkRequired({
      draft: { ...existingWithoutLink, contractEnd: '2028-01-01' },
      initialDraft: existingWithoutLink,
      allowLegacyNoLink: true,
    })).toBe(true);
    expect(linkRequired({
      draft: existingWithoutLink,
      initialDraft: existingWithoutLink,
      allowLegacyNoLink: false,
    })).toBe(true);
  });

  it('requires a sheet link and current preview when a saved V1 project is upgraded to V2', async () => {
    const { linkRequired, signature, syncIssue } = await loadParticipationSheetSyncHelpers();
    const savedV1Draft = {
      registrationRequirementsVersion: 1 as const,
      participationSheetLink: '',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [{
        memberName: '김정태', memberNickname: '에이블', role: '운영매니저', participationRate: 20,
      }],
    };
    const upgradedWithoutLink = {
      ...savedV1Draft,
      registrationRequirementsVersion: 2 as const,
    };

    expect(linkRequired({
      draft: upgradedWithoutLink,
      initialDraft: savedV1Draft,
      allowLegacyNoLink: true,
    })).toBe(true);

    const upgradedWithLinkedSheet = {
      ...upgradedWithoutLink,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-a/edit',
      teamMembersDetailed: [{
        ...savedV1Draft.teamMembersDetailed[0],
        monthlyRates: { '2026-01': 20 },
      }],
    };
    expect(syncIssue({
      draft: upgradedWithLinkedSheet,
      initialDraft: savedV1Draft,
      syncedSignature: null,
    })).toContain('다시 연동');

    const syncedSignature = signature({
      sheetLink: upgradedWithLinkedSheet.participationSheetLink,
      contractStart: upgradedWithLinkedSheet.contractStart,
      contractEnd: upgradedWithLinkedSheet.contractEnd,
      teamMembersDetailed: upgradedWithLinkedSheet.teamMembersDetailed,
    });
    expect(syncIssue({
      draft: upgradedWithLinkedSheet,
      initialDraft: savedV1Draft,
      syncedSignature,
    })).toBeNull();
  });

  it('does not trust an unsynced private registration draft merely because it was autosaved', async () => {
    const { syncIssue } = await loadParticipationSheetSyncHelpers();
    const autosavedDraft = {
      registrationRequirementsVersion: 2 as const,
      participationSheetLink: 'https://docs.google.com/spreadsheets/d/not-previewed/edit',
      contractStart: '2026-01-01',
      contractEnd: '2027-01-01',
      teamMembersDetailed: [],
    };

    expect(syncIssue({
      draft: autosavedDraft,
      initialDraft: autosavedDraft,
      syncedSignature: null,
      trustInitialPersistedSheetState: false,
    })).toContain('다시 연동');
  });

  it('preserves raw manual identity input while editing so Korean IME composition is not reformatted', () => {
    expect(normalizeProjectTeamMemberDraftRows([
      {
        inputMode: 'manual',
        identityInput: ' 박지연 ( 느티',
        memberName: '박지연 ( 느티',
        memberNickname: '',
        role: '',
        participationRate: 0,
      },
    ])).toEqual([
      {
        inputMode: 'manual',
        identityInput: ' 박지연 ( 느티',
        memberName: '박지연 ( 느티',
        memberNickname: '',
        role: '',
        participationRate: 0,
      },
    ]);
  });

  it('treats member with a PPT role and explicit document-only choice but no rate as complete', () => {
    expect(hasIncompleteProjectTeamMembers([
      { memberName: '김다은', memberNickname: '', role: '총괄책임자', participationRate: 0, isDocumentOnly: false },
    ])).toBe(false);
  });

  it('defaults a legacy PPT role missing isDocumentOnly to actual participation', () => {
    expect(projectTeamMembersForWrite([
      { memberName: '김다은', memberNickname: '', role: '운영매니저', participationRate: 0 },
    ])).toEqual([
      { memberName: '김다은', memberNickname: '', role: '운영매니저', participationRate: 0, isDocumentOnly: false },
    ]);
  });

  it('preserves the retired final-responsible role on legacy rows', () => {
    expect(hasIncompleteProjectTeamMembers([
      { memberName: '김다은', memberNickname: '', role: '사업 최종 책임자', participationRate: 50, isDocumentOnly: false },
    ])).toBe(false);
  });

  it('defaults a missing legacy document-only choice without accepting an invalid role', () => {
    expect(hasIncompleteProjectTeamMembers([
      { memberName: '김다은', memberNickname: '', role: 'PM', participationRate: 50 },
    ])).toBe(true);
  });

  it('detects incomplete rows but keeps normalized values trimmed', () => {
    const members = normalizeProjectTeamMembers([
      { memberName: ' 김다은 ', memberNickname: ' 데이나 ', role: ' ', participationRate: 50 },
      { memberName: '', memberNickname: '', role: '', participationRate: 0 },
    ]);

    expect(members).toEqual([
      { memberName: '김다은', memberNickname: '데이나', role: '', participationRate: 50 },
    ]);
    expect(hasIncompleteProjectTeamMembers(members)).toBe(true);
  });

  it('rejects a reversed labor allocation period before submit', () => {
    expect(hasInvalidProjectTeamMemberLaborPeriod([{
      memberName: '김다은',
      memberNickname: '',
      role: '운영매니저',
      participationRate: 50,
      isDocumentOnly: false,
      laborAllocationStartMonth: '2026-09',
      laborAllocationEndMonth: '2026-03',
    }])).toBe(true);
    expect(hasInvalidProjectTeamMemberLaborPeriod([{
      memberName: '김다은',
      memberNickname: '',
      role: '운영매니저',
      participationRate: 50,
      isDocumentOnly: false,
      laborAllocationStartMonth: '2026-03',
      laborAllocationEndMonth: '2026-09',
    }])).toBe(false);
    expect(hasInvalidProjectTeamMemberLaborPeriod([{
      memberName: '김다은',
      memberNickname: '',
      role: '운영매니저',
      participationRate: 50,
      isDocumentOnly: false,
      laborAllocationStartMonth: '2026-13',
      laborAllocationEndMonth: '2027-01',
    }])).toBe(true);
  });

  it('requires at least one operating manager for registration v2', () => {
    expect(hasProjectOperatingManager([])).toBe(false);
    expect(hasProjectOperatingManager([
      { memberName: '김다은', memberNickname: '', role: '실무책임자', participationRate: 50, isDocumentOnly: false },
    ])).toBe(false);
    expect(hasProjectOperatingManager([
      { memberName: '김다은', memberNickname: '', role: '운영매니저', participationRate: 50, isDocumentOnly: false },
    ])).toBe(true);
    expect(hasProjectOperatingManager([
      { memberName: '김다은', memberNickname: '', role: '운영매니저', participationRate: 0, isDocumentOnly: true },
    ])).toBe(true);
  });

  it('keeps the retired final-responsible role readable without offering it for new selection', () => {
    expect(PROJECT_TEAM_MEMBER_ROLES).not.toContain('사업 최종 책임자');
    expect(projectTeamMembersForWrite([
      { memberName: '기존 책임자', memberNickname: '', role: '사업 최종 책임자', participationRate: 0, isDocumentOnly: false },
      { memberName: '운영자', memberNickname: '', role: '운영매니저', participationRate: 100, isDocumentOnly: false },
    ])).toEqual([
      { memberName: '기존 책임자', memberNickname: '', role: '사업 최종 책임자', participationRate: 0, isDocumentOnly: false },
      { memberName: '운영자', memberNickname: '', role: '운영매니저', participationRate: 100, isDocumentOnly: false },
    ]);
  });


  it('parses manual identity input in 이름(별명) format', () => {
    expect(parseProjectTeamMemberIdentityInput('박지연(느티)')).toEqual({
      memberName: '박지연',
      memberNickname: '느티',
    });
    expect(parseProjectTeamMemberIdentityInput(' 박지연 ( 느티 ) ')).toEqual({
      memberName: '박지연',
      memberNickname: '느티',
    });
    expect(parseProjectTeamMemberIdentityInput('느티')).toEqual({
      memberName: '느티',
      memberNickname: '',
    });
  });
});
