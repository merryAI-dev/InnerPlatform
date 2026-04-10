import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import type { ProjectMigrationCandidate } from '../data/project-migration-candidates';
import type { ProjectMigrationAuditRow, ProjectMigrationCurrentRow } from './project-migration-audit';
import {
  buildMigrationAuditOperatorSummary,
  buildMigrationAuditConsoleRecords,
  buildMigrationAuditCicSelectionOptions,
  buildMigrationAuditDenseRows,
  collectMigrationAuditCicOptions,
  describeMigrationAuditActionState,
  filterMigrationAuditConsoleRecords,
  findMigrationAuditRecord,
  findDuplicateProjectsForMigrationAuditRecord,
  findProposalProjectsForMigrationAuditRecord,
  groupMigrationAuditConsoleRecords,
  normalizeCicLabel,
  suggestProjectsForMigrationAuditRecord,
  summarizeMigrationAuditConsole,
} from './project-migration-console';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    slug: 'p-1',
    orgId: 'mysc',
    name: '기본 프로젝트',
    status: 'IN_PROGRESS',
    type: 'C1',
    phase: 'CONFIRMED',
    contractAmount: 0,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'TYPE1',
    basis: '공급가액',
    accountType: 'OPERATING',
    paymentPlan: { contract: 0, interim: 0, final: 0 },
    paymentPlanDesc: '',
    clientOrg: '',
    groupwareName: '',
    participantCondition: '',
    contractType: '계약서(날인)',
    department: '',
    teamName: '',
    managerId: '',
    managerName: '',
    budgetCurrentYear: 0,
    taxInvoiceAmount: 0,
    profitRate: 0,
    profitAmount: 0,
    isSettled: false,
    finalPaymentNote: '',
    confirmerName: '',
    lastCheckedAt: '',
    cashflowDiffNote: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ProjectMigrationCandidate> = {}): ProjectMigrationCandidate {
  return {
    id: 'c-1',
    cic: 'CIC-A',
    department: '개발협력센터',
    coreMembers: '',
    groupwareProjectName: '',
    accountLabel: '운영통장',
    businessName: '원본 사업',
    clientOrg: 'KOICA',
    ...overrides,
  };
}

function makeRow(overrides: Partial<ProjectMigrationAuditRow> = {}): ProjectMigrationAuditRow {
  const project = makeProject({ name: '원본 사업', cic: 'CIC-A' });
  return {
    candidate: makeCandidate(),
    status: 'REGISTERED',
    match: {
      project,
      score: 100,
      exact: true,
      reasons: ['계약명 일치'],
    },
    ...overrides,
  };
}

describe('project-migration-console', () => {
  it('normalizes empty cic to 미지정', () => {
    expect(normalizeCicLabel('')).toBe('미지정');
    expect(normalizeCicLabel(undefined)).toBe('미지정');
    expect(normalizeCicLabel('CIC-A')).toBe('CIC-A');
  });

  it('groups rows by actionable status', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ status: 'MISSING', candidate: makeCandidate({ id: 'c-1', businessName: '미등록' }), match: null }),
      makeRow({ status: 'CANDIDATE', candidate: makeCandidate({ id: 'c-2', businessName: '후보' }), match: makeRow().match }),
      makeRow({ status: 'REGISTERED', candidate: makeCandidate({ id: 'c-3', businessName: '완료' }) }),
    ]);

    const grouped = groupMigrationAuditConsoleRecords(records);
    expect(grouped.missing).toHaveLength(1);
    expect(grouped.candidate).toHaveLength(1);
    expect(grouped.registered).toHaveLength(1);
  });

  it('filters by cic and search query', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ candidate: makeCandidate({ id: 'c-1', cic: 'CIC-A', businessName: '에코스타트업' }) }),
      makeRow({ candidate: makeCandidate({ id: 'c-2', cic: 'CIC-B', businessName: '기후테크' }) }),
    ]);

    const filtered = filterMigrationAuditConsoleRecords(records, {
      cic: 'CIC-B',
      status: 'ALL',
      query: '기후',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].candidate.id).toBe('c-2');
  });

  it('prefers same-cic projects in duplicate suggestions', () => {
    const record = buildMigrationAuditConsoleRecords([
      makeRow({ candidate: makeCandidate({ businessName: '에코스타트업', cic: 'CIC-A' }) }),
    ])[0];

    const suggestions = suggestProjectsForMigrationAuditRecord(record, [
      makeProject({ id: 'p-1', name: '에코스타트업 운영', cic: 'CIC-B' }),
      makeProject({ id: 'p-2', name: '에코스타트업 운영', cic: 'CIC-A' }),
    ]);

    expect(suggestions[0].id).toBe('p-2');
  });

  it('summarizes queue counts and completion ratio', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ status: 'MISSING', match: null }),
      makeRow({ status: 'CANDIDATE' }),
      makeRow({ status: 'REGISTERED' }),
    ]);

    const summary = summarizeMigrationAuditConsole(records);
    expect(summary.missing).toBe(1);
    expect(summary.candidate).toBe(1);
    expect(summary.registered).toBe(1);
    expect(summary.completionRatio).toBeCloseTo(33.3, 0);
  });

  it('counts current-only missing rows inside the missing summary bucket', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ status: 'REGISTERED' }),
    ]);

    const summary = summarizeMigrationAuditConsole(records, 2);
    expect(summary.total).toBe(3);
    expect(summary.missing).toBe(2);
    expect(summary.registered).toBe(1);
    expect(summary.completionRatio).toBeCloseTo(33.3, 0);
  });

  it('collects cic options from source and current rows', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ candidate: makeCandidate({ cic: 'CIC-A' }) }),
    ]);
    const currentRows: ProjectMigrationCurrentRow[] = [
      { project: makeProject({ id: 'p-2', cic: 'CIC-B' }), status: 'MISSING', match: null },
      { project: makeProject({ id: 'p-3', cic: undefined, department: '투자센터' }), status: 'MISSING', match: null },
    ];

    expect(collectMigrationAuditCicOptions(records, currentRows)).toEqual([
      '개발협력센터',
      '글로벌센터',
      '조인트액션',
      '투자센터',
      'AXR팀',
      'CI그룹',
      'CIC-A',
      'CIC-B',
      'CIC1',
      'CIC2',
      'CIC3',
      'CIC4',
      'DXR팀',
    ]);
  });

  it('falls back to project department when explicit cic is missing', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ candidate: makeCandidate({ cic: 'CIC-A' }) }),
    ]);
    const currentRows: ProjectMigrationCurrentRow[] = [
      { project: makeProject({ id: 'p-2', cic: undefined, department: '투자센터' }), status: 'MISSING', match: null },
    ];

    expect(collectMigrationAuditCicOptions(records, currentRows)).toContain('투자센터');
  });

  it('falls back to candidate department when candidate cic is missing', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ candidate: makeCandidate({ cic: '', department: '투자센터' }) }),
    ]);

    expect(records[0].cic).toBe('투자센터');
  });

  it('builds cic selection options with a single 미지정 entry', () => {
    expect(buildMigrationAuditCicSelectionOptions(['CIC-A', '미지정', 'CIC-A'])).toEqual(['CIC-A', '미지정']);
  });

  it('falls back to the first record when selected id is missing', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ candidate: makeCandidate({ id: 'c-1' }) }),
      makeRow({ candidate: makeCandidate({ id: 'c-2' }) }),
    ]);

    expect(findMigrationAuditRecord(records, 'missing')?.id).toBe('c-1');
    expect(findMigrationAuditRecord(records, 'c-2')?.id).toBe('c-2');
  });

  it('builds dense rows for source and current-only items', () => {
    const records = buildMigrationAuditConsoleRecords([
      makeRow({ candidate: makeCandidate({ id: 'c-1' }) }),
    ]);
    const currentRows: ProjectMigrationCurrentRow[] = [
      { project: makeProject({ id: 'p-2', name: '현재만', cic: 'CIC-B' }), status: 'MISSING', match: null },
    ];

    const denseRows = buildMigrationAuditDenseRows(records, currentRows);
    expect(denseRows).toHaveLength(2);
    expect(denseRows[0].kind).toBe('source');
    expect(denseRows[1].kind).toBe('current-only');
  });

  it('builds an operator summary that prioritizes missing work over completed rows', () => {
    const summary = buildMigrationAuditOperatorSummary({
      total: 25,
      missing: 12,
      candidate: 3,
      registered: 10,
      unassignedCic: 8,
      completionRatio: 40,
    });

    expect(summary.headline).toBe('지금 먼저 처리할 15건');
    expect(summary.caption).toContain('미등록 12건');
    expect(summary.caption).toContain('후보 검토 3건');
  });

  it('describes detail panel action state for missing and completed records', () => {
    const missingRecord = buildMigrationAuditConsoleRecords([
      makeRow({ status: 'MISSING', match: null }),
    ])[0];
    const registeredRecord = buildMigrationAuditConsoleRecords([
      makeRow({ status: 'REGISTERED' }),
    ])[0];

    expect(describeMigrationAuditActionState(missingRecord)).toMatchObject({
      label: '등록 필요',
      tone: 'danger',
      helper: '기존 프로젝트에 연결하거나 새 프로젝트를 만들어야 합니다.',
    });
    expect(describeMigrationAuditActionState(registeredRecord)).toMatchObject({
      label: '연결 완료',
      tone: 'success',
      helper: '필요하면 등록 조직이나 연결 프로젝트만 조정하면 됩니다.',
    });
  });

  it('finds PM portal draft proposals that match the source row', () => {
    const record = buildMigrationAuditConsoleRecords([
      makeRow({
        status: 'MISSING',
        match: null,
        candidate: makeCandidate({
          businessName: '2026년 중장년 창업컨설팅 지원사업',
          department: '투자센터',
        }),
      }),
    ])[0];

    const proposals = findProposalProjectsForMigrationAuditRecord(record, [
      makeProject({
        id: 'p-proposal',
        name: '2026년 중장년 창업컨설팅 지원사업',
        department: '투자센터',
        registrationSource: 'pm_portal',
        status: 'CONTRACT_PENDING',
      }),
      makeProject({
        id: 'p-live',
        name: '이미 운영 중인 사업',
        department: '투자센터',
        registrationSource: 'manual',
        status: 'IN_PROGRESS',
      }),
    ]);

    expect(proposals.map((project) => project.id)).toEqual(['p-proposal']);
  });

  it('prefers same client org proposal candidates before name-only matches from another org', () => {
    const record = buildMigrationAuditConsoleRecords([
      makeRow({
        status: 'MISSING',
        match: null,
        candidate: makeCandidate({
          businessName: '현대 모비스 CSV OI 컨설팅',
          clientOrg: '현대 모비스',
          department: '투자센터',
        }),
      }),
    ])[0];

    const proposals = findProposalProjectsForMigrationAuditRecord(record, [
      makeProject({
        id: 'p-name-only',
        name: '현대 모비스 CSV OI 컨설팅 운영안',
        clientOrg: '다른 기관',
        department: '투자센터',
        registrationSource: 'pm_portal',
        status: 'CONTRACT_PENDING',
      }),
      makeProject({
        id: 'p-org-match',
        name: '완전히 다른 이름',
        clientOrg: '현대 모비스',
        department: '투자센터',
        registrationSource: 'pm_portal',
        status: 'CONTRACT_PENDING',
      }),
    ]);

    expect(proposals.map((project) => project.id)).toEqual(['p-org-match', 'p-name-only']);
  });

  it('finds non-trashed duplicate candidates around the same source row', () => {
    const record = buildMigrationAuditConsoleRecords([
      makeRow({
        status: 'MISSING',
        match: null,
        candidate: makeCandidate({
          businessName: '현대 모비스 CSV OI 컨설팅',
          clientOrg: '현대 모비스',
          department: '투자센터',
        }),
      }),
    ])[0];

    const duplicates = findDuplicateProjectsForMigrationAuditRecord(record, [
      makeProject({
        id: 'p-primary',
        name: '현대 모비스 CSV OI 컨설팅',
        officialContractName: '현대 모비스 CSV OI 컨설팅',
        clientOrg: '현대 모비스',
        department: '투자센터',
        status: 'IN_PROGRESS',
      }),
      makeProject({
        id: 'p-proposal',
        name: '현대 모비스 CSV OI 컨설팅',
        clientOrg: '현대 모비스',
        department: '투자센터',
        registrationSource: 'pm_portal',
        status: 'CONTRACT_PENDING',
      }),
      makeProject({
        id: 'p-trashed',
        name: '현대 모비스 CSV OI 컨설팅',
        clientOrg: '현대 모비스',
        department: '투자센터',
        trashedAt: '2026-04-06T00:00:00.000Z',
      }),
    ]);

    expect(duplicates.map((project) => project.id)).toEqual(['p-primary', 'p-proposal']);
  });

  it('prefers live duplicate candidates before draft proposals when both are plausible matches', () => {
    const record = buildMigrationAuditConsoleRecords([
      makeRow({
        status: 'MISSING',
        match: null,
        candidate: makeCandidate({
          businessName: '현대 모비스 CSV OI 컨설팅',
          clientOrg: '현대 모비스',
          department: '투자센터',
        }),
      }),
    ])[0];

    const duplicates = findDuplicateProjectsForMigrationAuditRecord(record, [
      makeProject({
        id: 'p-draft-name-match',
        name: '현대 모비스 CSV OI 컨설팅',
        clientOrg: '현대 모비스',
        department: '투자센터',
        registrationSource: 'pm_portal',
        status: 'CONTRACT_PENDING',
      }),
      makeProject({
        id: 'p-live-org-match',
        name: '운영 관리안',
        clientOrg: '현대 모비스',
        department: '투자센터',
        status: 'IN_PROGRESS',
      }),
    ]);

    expect(duplicates.map((project) => project.id)).toEqual(['p-live-org-match', 'p-draft-name-match']);
  });
});
