import { describe, expect, it } from 'vitest';
import type { Project, ProjectRequest } from '../data/types';
import {
  buildMigrationAuditConsoleRecords,
  collectMigrationAuditCicOptions,
  describeMigrationAuditActionState,
  filterMigrationAuditConsoleRecords,
  findMigrationAuditRecord,
  normalizeCicLabel,
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
    registrationSource: 'pm_portal',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ProjectRequest> = {}): ProjectRequest {
  return {
    id: 'pr-1',
    tenantId: 'mysc',
    status: 'APPROVED',
    reviewOutcome: 'APPROVED',
    requestedBy: 'u-1',
    requestedByName: '변민욱',
    requestedByEmail: 'pm@example.com',
    requestedAt: '2026-04-20T08:00:00.000Z',
    approvedProjectId: 'p-1',
    payload: {
      name: '기본 프로젝트',
      officialContractName: '기본 프로젝트 공식명',
      type: 'C1',
      description: '설명',
      clientOrg: 'KOICA',
      department: 'CIC-A',
      contractAmount: 10000000,
      salesVatAmount: 0,
      totalRevenueAmount: 10000000,
      supportAmount: 0,
      contractStart: '2026-01-01',
      contractEnd: '2026-12-31',
      settlementType: 'TYPE1',
      basis: '공급가액',
      accountType: 'OPERATING',
      paymentPlanDesc: '계약금 100%',
      settlementGuide: '',
      projectPurpose: '목적',
      managerName: '변민욱',
      teamName: 'CIC-A',
      teamMembers: '변민욱',
      participantCondition: '',
      note: '',
      contractDocument: null,
      contractAnalysis: null,
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

  it('builds review queue records from PM portal projects only', () => {
    const records = buildMigrationAuditConsoleRecords(
      [
        makeProject({ id: 'p-1', name: '에코스타트업', cic: 'CIC-A' }),
        makeProject({ id: 'p-2', name: '기후테크', cic: 'CIC-B', executiveReviewStatus: 'REVISION_REJECTED' }),
        makeProject({ id: 'p-3', registrationSource: 'manual', name: '기존 등록 사업', cic: 'CIC-C' }),
      ],
      [
        makeRequest({ approvedProjectId: 'p-1', payload: { ...makeRequest().payload, department: 'CIC-A' } }),
      ],
    );

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.id)).toEqual(['p-1', 'p-2', 'p-3']);
    expect(records[0].status).toBe('PENDING');
    expect(records[1].status).toBe('REVISION_REJECTED');
    expect(records[2].status).toBe('APPROVED');
  });

  it('filters by cic and review status', () => {
    const records = buildMigrationAuditConsoleRecords(
      [
        makeProject({ id: 'p-1', name: '에코스타트업', cic: 'CIC-A' }),
        makeProject({ id: 'p-2', name: '기후테크', cic: 'CIC-B', executiveReviewStatus: 'APPROVED' }),
      ],
      [],
    );

    const filtered = filterMigrationAuditConsoleRecords(records, {
      cic: 'CIC-B',
      status: 'APPROVED',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].project.id).toBe('p-2');
  });

  it('summarizes review queue counts by executive outcome across all projects', () => {
    const records = buildMigrationAuditConsoleRecords(
      [
        makeProject({ id: 'p-1', executiveReviewStatus: 'APPROVED' }),
        makeProject({ id: 'p-2', executiveReviewStatus: 'REVISION_REJECTED' }),
        makeProject({ id: 'p-3', executiveReviewStatus: 'DUPLICATE_DISCARDED' }),
        makeProject({ id: 'p-4' }),
        makeProject({ id: 'p-5', registrationSource: 'manual' }),
      ],
      [],
    );

    const summary = summarizeMigrationAuditConsole(records);
    expect(summary.pending).toBe(1);
    expect(summary.approved).toBe(2);
    expect(summary.rejected).toBe(1);
    expect(summary.discarded).toBe(1);
    expect(summary.total).toBe(5);
  });

  it('collects cic options from PM portal projects only', () => {
    const records = buildMigrationAuditConsoleRecords(
      [
        makeProject({ id: 'p-1', cic: 'CIC-A', department: 'CIC-A' }),
        makeProject({ id: 'p-2', cic: undefined, department: '투자센터' }),
      ],
      [],
    );

    expect(collectMigrationAuditCicOptions(records)).toEqual(['투자센터', 'CIC-A']);
  });

  it('falls back to the first record when selected id is missing', () => {
    const records = buildMigrationAuditConsoleRecords(
      [
        makeProject({ id: 'p-1', name: '첫번째' }),
        makeProject({ id: 'p-2', name: '두번째' }),
      ],
      [],
    );

    expect(findMigrationAuditRecord(records, 'missing')?.id).toBe('p-1');
    expect(findMigrationAuditRecord(records, 'p-2')?.id).toBe('p-2');
  });

  it('describes action state as executive review progress instead of migration matching', () => {
    const pendingRecord = buildMigrationAuditConsoleRecords(
      [makeProject({ id: 'p-1' })],
      [],
    )[0];
    const approvedRecord = buildMigrationAuditConsoleRecords(
      [makeProject({ id: 'p-2', executiveReviewStatus: 'APPROVED' })],
      [],
    )[0];
    const discardedRecord = buildMigrationAuditConsoleRecords(
      [makeProject({ id: 'p-3', executiveReviewStatus: 'DUPLICATE_DISCARDED' })],
      [],
    )[0];

    expect(describeMigrationAuditActionState(pendingRecord)).toMatchObject({
      label: '검토 대기',
      tone: 'warning',
    });
    expect(describeMigrationAuditActionState(approvedRecord)).toMatchObject({
      label: '승인 완료',
      tone: 'success',
    });
    expect(describeMigrationAuditActionState(discardedRecord)).toMatchObject({
      label: '중복·폐기',
      tone: 'neutral',
    });
  });
});
