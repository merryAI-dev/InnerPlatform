import { describe, expect, it } from 'vitest';
import { buildProjectMigrationAuditRows, buildProjectMigrationCurrentRows } from './project-migration-audit';
import type { Project } from '../data/types';
import type { ProjectMigrationCandidate } from '../data/project-migration-candidates';

function makeProject(overrides: Partial<Project>): Project {
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

function makeCandidate(overrides: Partial<ProjectMigrationCandidate>): ProjectMigrationCandidate {
  return {
    id: 'candidate-1',
    department: 'L-개발협력센터',
    coreMembers: '',
    groupwareProjectName: '',
    accountLabel: '운영통장',
    businessName: '기본 사업',
    clientOrg: '',
    ...overrides,
  };
}

describe('buildProjectMigrationAuditRows', () => {
  it('marks an exact business-name match as registered', () => {
    const rows = buildProjectMigrationAuditRows(
      [makeCandidate({ businessName: '2026 에코스타트업', clientOrg: '한국환경산업기술원' })],
      [makeProject({ name: '2026 에코스타트업', clientOrg: '한국환경산업기술원' })],
    );

    expect(rows[0].status).toBe('REGISTERED');
    expect(rows[0].match?.reasons).toContain('현재 프로젝트명 일치');
  });

  it('accepts KOICA alias client names as the same organization', () => {
    const rows = buildProjectMigrationAuditRows(
      [makeCandidate({ businessName: 'KOICA SEED0', clientOrg: '한국국제협력단(KOICA)' })],
      [makeProject({ name: 'KOICA SEED0', clientOrg: 'KOICA' })],
    );

    expect(rows[0].status).toBe('REGISTERED');
    expect(rows[0].match?.reasons).toContain('발주기관 일치');
  });

  it('keeps placeholder groupware names from creating false exact matches', () => {
    const rows = buildProjectMigrationAuditRows(
      [makeCandidate({ businessName: '현대 모비스 CSV OI 컨설팅', groupwareProjectName: '(등록 전) 사업 계약 전' })],
      [makeProject({ name: '다른 프로젝트', groupwareName: '사업 계약 전' })],
    );

    expect(rows[0].status).toBe('MISSING');
  });

  it('marks loose but non-exact matches as candidates', () => {
    const rows = buildProjectMigrationAuditRows(
      [makeCandidate({ businessName: '2026년 해양수산 액셀러레이터 운영 프로그램 수행계획서', clientOrg: '해양수산과학기술진흥원' })],
      [makeProject({ name: '2026 해양수산 액셀러레이터 운영 프로그램', clientOrg: '해양수산과학기술진흥원' })],
    );

    expect(rows[0].status).toBe('CANDIDATE');
    expect(rows[0].match?.reasons).toContain('현재 프로젝트명 유사');
  });

  it('treats an exact official contract name as a registered match', () => {
    const rows = buildProjectMigrationAuditRows(
      [makeCandidate({ businessName: '2023-2026 창업투자 전문기관을 통한 혁신적기술프로그램(CTS)참여기업 역량 강화 용역' })],
      [makeProject({
        name: 'CTS역량강화',
        officialContractName: '2023-2026 창업투자 전문기관을 통한 혁신적기술프로그램(CTS)참여기업 역량 강화 용역',
      })],
    );

    expect(rows[0].status).toBe('REGISTERED');
    expect(rows[0].match?.reasons).toContain('계약명 일치');
  });

  it('keeps compact cohort-style project names as candidates when core tokens match', () => {
    const rows = buildProjectMigrationAuditRows(
      [makeCandidate({ businessName: '2026 농식품 기술창업 액셀러레이터 육성지원' })],
      [makeProject({ name: '2026농식품5기' })],
    );

    expect(rows[0].status).toBe('CANDIDATE');
    expect(rows[0].match?.reasons).toContain('현재 프로젝트명 유사');
  });

  it('assigns each platform project to only one source row', () => {
    const rows = buildProjectMigrationAuditRows(
      [
        makeCandidate({ id: 'candidate-contract', businessName: '2023-2026 창업투자 전문기관을 통한 혁신적기술프로그램(CTS)참여기업 역량 강화 용역' }),
        makeCandidate({ id: 'candidate-short', businessName: 'CTS역량강화' }),
      ],
      [makeProject({
        id: 'p-cts',
        name: 'CTS역량강화',
        officialContractName: '2023-2026 창업투자 전문기관을 통한 혁신적기술프로그램(CTS)참여기업 역량 강화 용역',
      })],
    );

    expect(rows[0].status).toBe('REGISTERED');
    expect(rows[0].match?.project.id).toBe('p-cts');
    expect(rows[1].status).toBe('MISSING');
    expect(rows[1].match).toBeNull();
  });

  it('builds current-project rows for reverse lookup', () => {
    const rows = buildProjectMigrationAuditRows(
      [makeCandidate({ businessName: '2026 에코스타트업', clientOrg: '한국환경산업기술원' })],
      [makeProject({ id: 'p-eco', name: '2026 에코스타트업', clientOrg: '한국환경산업기술원' })],
    );

    const currentRows = buildProjectMigrationCurrentRows(rows, [
      makeProject({ id: 'p-eco', name: '2026 에코스타트업', clientOrg: '한국환경산업기술원' }),
    ]);

    expect(currentRows[0].status).toBe('REGISTERED');
    expect(currentRows[0].match?.candidate.businessName).toBe('2026 에코스타트업');
  });
});
