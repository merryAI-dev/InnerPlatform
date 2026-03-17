import { describe, expect, it } from 'vitest';
import {
  buildProjectDiscoveryEntry,
  extractContractStoragePaths,
  normalizeManifest,
  sanitizeMemberDocForProjects,
} from '../../../scripts/firestore_live_cutover';

describe('normalizeManifest', () => {
  it('applies safe defaults', () => {
    const manifest = normalizeManifest({
      orgId: 'mysc',
      projectIds: ['p1', 'p1', 'p2'],
    });

    expect(manifest.projectIds).toEqual(['p1', 'p2']);
    expect(manifest.includeProjectRequests).toBe(true);
    expect(manifest.includeAuditLogs).toBe(false);
    expect(manifest.includeContractStorage).toBe(true);
  });

  it('throws when no project ids are provided', () => {
    expect(() => normalizeManifest({ orgId: 'mysc', projectIds: [] })).toThrow(/projectIds/);
  });
});

describe('buildProjectDiscoveryEntry', () => {
  it('flags likely test data using name heuristics', () => {
    const entry = buildProjectDiscoveryEntry('demo-1', {
      name: '업로드 검증 프로젝트',
      clientOrg: '테스트 기관',
    });

    expect(entry.likelyTestData).toBe(true);
    expect(entry.reasons).toContain('korean_test_keyword');
    expect(entry.reasons).toContain('non_standard_project_id');
  });

  it('does not flag a normal live project by default', () => {
    const entry = buildProjectDiscoveryEntry('p1773638600519', {
      name: '경기사경(환경)',
      officialContractName: '2025 경기도사회적경제원 사회환경 문제해결 지원사업',
      status: 'CONTRACT_PENDING',
      phase: 'CONFIRMED',
    });

    expect(entry.likelyTestData).toBe(false);
    expect(entry.reasons).toEqual([]);
  });
});

describe('extractContractStoragePaths', () => {
  it('collects unique storage paths from project and request payload docs', () => {
    const paths = extractContractStoragePaths([
      {
        contractDocument: {
          path: 'orgs/mysc/project-request-contracts/u1/a.pdf',
        },
      },
      {
        payload: {
          contractDocument: {
            path: 'orgs/mysc/project-request-contracts/u1/b.pdf',
          },
        },
      },
      {
        contractDocument: {
          path: 'orgs/mysc/project-request-contracts/u1/a.pdf',
        },
      },
    ]);

    expect(paths).toEqual([
      'orgs/mysc/project-request-contracts/u1/a.pdf',
      'orgs/mysc/project-request-contracts/u1/b.pdf',
    ]);
  });
});

describe('sanitizeMemberDocForProjects', () => {
  it('removes unrelated project ids from member docs', () => {
    const next = sanitizeMemberDocForProjects(
      {
        projectId: 'import-projects-1',
        projectIds: ['import-projects-1', 'p1773651024850'],
        projectNames: {
          'import-projects-1': '더미',
          p1773651024850: '2026 다자간협력',
        },
        portalProfile: {
          projectId: 'import-projects-1',
          projectIds: ['import-projects-1', 'p1773651024850'],
          projectNames: {
            'import-projects-1': '더미',
            p1773651024850: '2026 다자간협력',
          },
        },
      },
      new Set(['p1773651024850']),
    );

    expect(next.projectId).toBe('p1773651024850');
    expect(next.projectIds).toEqual(['p1773651024850']);
    expect(next.projectNames).toEqual({
      p1773651024850: '2026 다자간협력',
    });
    expect(next.portalProfile).toEqual({
      projectId: 'p1773651024850',
      projectIds: ['p1773651024850'],
      projectNames: {
        p1773651024850: '2026 다자간협력',
      },
    });
  });
});
