import { describe, expect, it } from 'vitest';
import type { ProjectMigrationCandidate } from '../data/project-migration-candidates';
import { buildQuickMigrationProject } from './project-migration-quick-create';

function makeCandidate(overrides: Partial<ProjectMigrationCandidate> = {}): ProjectMigrationCandidate {
  return {
    id: 'candidate-1',
    cic: 'CIC-A',
    department: '개발협력센터',
    coreMembers: '',
    groupwareProjectName: 'GW-001',
    accountLabel: '운영통장',
    businessName: '2026 에코스타트업',
    clientOrg: '한국환경산업기술원',
    ...overrides,
  };
}

describe('buildQuickMigrationProject', () => {
  it('builds a valid quick-create project with required defaults', () => {
    const project = buildQuickMigrationProject({
      orgId: 'mysc',
      candidate: makeCandidate(),
      name: '에코스타트업 운영',
      cic: 'CIC-A',
      actor: { uid: 'u-1', name: '보람' },
      now: '2026-04-06T12:00:00.000Z',
    });

    expect(project.orgId).toBe('mysc');
    expect(project.name).toBe('에코스타트업 운영');
    expect(project.status).toBe('CONTRACT_PENDING');
    expect(project.contractStart).toBe('2026-04-06');
    expect(project.settlementType).toBe('NONE');
  });

  it('propagates official contract name and cic', () => {
    const project = buildQuickMigrationProject({
      orgId: 'mysc',
      candidate: makeCandidate({ businessName: '공식 계약명', cic: 'CIC-B' }),
      name: '내부 프로젝트명',
      cic: 'CIC-B',
      actor: { uid: 'u-1', name: '보람' },
      now: '2026-04-06T12:00:00.000Z',
    });

    expect(project.officialContractName).toBe('공식 계약명');
    expect(project.cic).toBe('CIC-B');
  });

  it('normalizes slug and id fields', () => {
    const project = buildQuickMigrationProject({
      orgId: 'mysc',
      candidate: makeCandidate(),
      name: '에코스타트업 운영',
      cic: 'CIC-A',
      actor: { uid: 'u-1', name: '보람' },
      now: '2026-04-06T12:00:00.000Z',
    });

    expect(project.id.startsWith('p_')).toBe(true);
    expect(project.slug.length).toBeGreaterThan(5);
  });

  it('maps account label to account type', () => {
    const dedicated = buildQuickMigrationProject({
      orgId: 'mysc',
      candidate: makeCandidate({ accountLabel: '전용통장' }),
      name: '전용 사업',
      cic: 'CIC-A',
      actor: { uid: 'u-1', name: '보람' },
      now: '2026-04-06T12:00:00.000Z',
    });

    expect(dedicated.accountType).toBe('DEDICATED');
  });
});
