import { describe, expect, it } from 'vitest';
import type { ParticipationEntry, Project } from '../data/types';
import {
  buildAllProjectTeamParticipationEntries,
  buildProjectTeamParticipationEntries,
  resolveProjectTeamSettlementSystem,
} from './project-team-participation';

const project: Project = {
  id: 'p-1',
  slug: 'p-1',
  orgId: 'mysc',
  name: '팀원 테스트',
  status: 'IN_PROGRESS',
  type: 'D1',
  phase: 'CONFIRMED',
  contractAmount: 100000,
  contractStart: '2026-01-01',
  contractEnd: '2026-12-31',
  settlementType: 'NONE',
  basis: 'NONE',
  accountType: 'NONE',
  paymentPlan: { contract: 0, interim: 0, final: 0 },
  paymentPlanDesc: '',
  clientOrg: 'MYSC',
  groupwareName: '',
  participantCondition: '',
  teamMembersDetailed: [
    { memberName: '변민욱', memberNickname: '보람', role: 'PM', participationRate: 80 },
    { memberName: '이지영', memberNickname: '이지', role: '정산', participationRate: 20 },
  ],
  contractType: '계약서(날인)',
  department: 'CIC',
  teamName: '팀',
  managerId: 'u-1',
  managerName: '변민욱',
  budgetCurrentYear: 100000,
  taxInvoiceAmount: 0,
  profitRate: 0,
  profitAmount: 0,
  isSettled: false,
  finalPaymentNote: '',
  confirmerName: '',
  lastCheckedAt: '',
  cashflowDiffNote: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
};

function makeEntry(overrides: Partial<ParticipationEntry> = {}): ParticipationEntry {
  return {
    id: 'pe-1',
    memberId: 'u-1',
    memberName: '변민욱(보람)',
    projectId: 'p-1',
    projectName: '팀원 테스트',
    rate: 80,
    settlementSystem: 'NONE',
    clientOrg: 'MYSC',
    periodStart: '2026-01',
    periodEnd: '2026-12',
    isDocumentOnly: false,
    note: '',
    updatedAt: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('project-team-participation', () => {
  it('adds project team members as display participation entries when no formal entries exist', () => {
    const entries = buildProjectTeamParticipationEntries(project, []);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      memberId: 'e65',
      memberName: '변민욱 (보람)',
      rate: 80,
      source: 'PROJECT_TEAM_SYNC',
      note: 'PM',
      periodStart: '2026-01',
      periodEnd: '2026-12',
    });
  });

  it('does not duplicate a team member that already has a formal participation entry', () => {
    const entries = buildProjectTeamParticipationEntries(project, [makeEntry()]);

    expect(entries.map((entry) => entry.memberName)).toEqual([
      '변민욱(보람)',
      '이지영 (이지)',
    ]);
  });

  it('does not duplicate when the formal entry only stores the real name', () => {
    const entries = buildProjectTeamParticipationEntries(project, [makeEntry({ memberName: '변민욱' })]);

    expect(entries.map((entry) => entry.memberName)).toEqual([
      '변민욱',
      '이지영 (이지)',
    ]);
  });

  it('drops stale project-team sync rows and regenerates from the current project team', () => {
    const entries = buildProjectTeamParticipationEntries(
      { ...project, teamMembersDetailed: [] },
      [
        makeEntry({
          id: 'stale-sync',
          memberId: 'project-team:변민욱보람',
          memberName: '변민욱 (보람)',
          source: 'PROJECT_TEAM_SYNC',
          projectTeamMemberKey: '변민욱보람',
        }),
      ],
    );

    expect(entries).toEqual([]);
  });

  it('maps Type5 or dedicated account project team rows to e나라도움 for admin rollups', () => {
    expect(resolveProjectTeamSettlementSystem({ ...project, settlementType: 'TYPE5' })).toBe('E_NARA_DOUM');
    expect(resolveProjectTeamSettlementSystem({ ...project, accountType: 'DEDICATED' })).toBe('E_NARA_DOUM');
    expect(resolveProjectTeamSettlementSystem(project)).toBe('NONE');
  });

  it('uses the canonical employee id for project-team rows when possible', () => {
    const entries = buildProjectTeamParticipationEntries(project, []);

    expect(entries.map((entry) => entry.memberId)).toEqual(['e65', 'e82']);
  });

  it('can build admin-wide display entries from formal rows plus current project teams', () => {
    const entries = buildAllProjectTeamParticipationEntries(
      [{ ...project, settlementType: 'TYPE5' }],
      [
        makeEntry({
          id: 'other-project',
          projectId: 'outside',
          memberName: '외부 인력',
          settlementSystem: 'ACCOUNTANT',
        }),
        makeEntry({
          id: 'stale-sync',
          memberId: 'project-team:old',
          memberName: '옛 팀원',
          source: 'PROJECT_TEAM_SYNC',
        }),
      ],
    );

    expect(entries.map((entry) => entry.memberName)).toEqual([
      '외부 인력',
      '변민욱 (보람)',
      '이지영 (이지)',
    ]);
    expect(entries.find((entry) => entry.memberName === '변민욱 (보람)')?.settlementSystem).toBe('E_NARA_DOUM');
  });
});
