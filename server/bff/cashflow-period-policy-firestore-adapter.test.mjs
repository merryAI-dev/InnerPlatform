import { describe, expect, it, vi } from 'vitest';
import {
  createCashflowPeriodPolicyFirestoreAdapter,
} from './cashflow-period-policy-firestore-adapter.mjs';
import { createCashflowPeriodPolicyService } from './cashflow-period-policy-service.mjs';

function createReadDb(documents) {
  const store = new Map(Object.entries(documents));
  const limits = [];

  function collectionDocs(path) {
    const prefix = `${path}/`;
    return [...store.entries()]
      .filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'))
      .map(([candidate, data]) => ({
        id: candidate.slice(prefix.length),
        data: () => data,
      }));
  }

  function query(path, limitValue = null) {
    return {
      limit(value) {
        limits.push({ path, value });
        return query(path, value);
      },
      async get() {
        const docs = collectionDocs(path);
        return {
          docs: Number.isSafeInteger(limitValue) ? docs.slice(0, limitValue) : docs,
          size: Number.isSafeInteger(limitValue) ? Math.min(docs.length, limitValue) : docs.length,
        };
      },
    };
  }

  return {
    db: {
      collection: (path) => query(path),
      doc: vi.fn(),
      runTransaction: vi.fn(),
    },
    limits,
  };
}

describe('cashflow period policy Firestore adapter', () => {
  it('caps every dashboard collection and reports truncation instead of returning an unbounded result', async () => {
    const { db, limits } = createReadDb({
      'orgs/tenant-a/projects/project-a': { name: 'A' },
      'orgs/tenant-a/projects/project-b': { name: 'B' },
      'orgs/tenant-a/projects/project-c': { name: 'C' },
    });
    const adapter = createCashflowPeriodPolicyFirestoreAdapter({
      db,
      auditChainService: { appendManyInTransaction: vi.fn() },
      readLimit: 2,
    });

    const evidence = await adapter.readPolicyEvidence({ tenantId: 'tenant-a' });

    expect(evidence.projects).toMatchObject({ available: true, truncated: true });
    expect(evidence.projects.records.map((record) => record.id)).toEqual(['project-a', 'project-b']);
    expect(limits).toHaveLength(10);
    expect(limits.every(({ value }) => value === 3)).toBe(true);
  });

  it('surfaces capped project evidence as PARTIAL/TRUNCATED without treating omitted rows as normal', async () => {
    const emptyStore = { available: true, truncated: false, records: [] };
    const persistencePort = {
      assertRuntimeSuperadmin: vi.fn(async () => undefined),
      readPolicyEvidence: vi.fn(async () => ({
        projects: {
          available: true,
          truncated: true,
          records: [{ id: 'project-a', data: { id: 'project-a', name: 'A' } }],
        },
        heads: emptyStore,
        closes: emptyStore,
        runs: emptyStore,
        requests: emptyStore,
        mirrors: emptyStore,
        completions: emptyStore,
        amendments: emptyStore,
        people: emptyStore,
        members: emptyStore,
      })),
      readProject: vi.fn(),
      readProjectRecoveryEvidence: vi.fn(),
      readProjectResetEvidence: vi.fn(),
      transactExecutiveApproverChange: vi.fn(),
      applyCumulativeCloseHeadRecovery: vi.fn(),
      applyCumulativeCloseResetToReclose: vi.fn(),
    };
    const service = createCashflowPeriodPolicyService({
      persistencePort,
      now: () => '2026-08-14T01:02:03.000Z',
    });

    const response = await service.readPolicy({ tenantId: 'tenant-a', actorId: 'admin-uid' });

    expect(response.status).toBe('PARTIAL');
    expect(response.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROJECT_STORE_TRUNCATED', severity: 'WARNING' }),
    ]));
  });
});
