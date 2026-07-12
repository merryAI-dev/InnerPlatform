import { describe, expect, it, vi } from 'vitest';
import { createIdempotencyService } from '../idempotency.mjs';
import { buildActiveEditLeaseDocument, resolveEditLeaseDocumentId } from '../edit-lease.mjs';
import { loadRbacPolicy } from '../rbac-policy.mjs';
import {
  createCashflowEditDraftService,
  mountCashflowEditDraftRoutes,
} from './cashflow-edit-drafts.mjs';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  function snapshot(path) {
    const exists = documents.has(path);
    return { exists, data: () => (exists ? clone(documents.get(path)) : undefined) };
  }
  return {
    documents,
    doc: (path) => ({ path }),
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: async (ref) => snapshot(ref.path),
        set: (ref, value, options = {}) => writes.push({ ref, value: clone(value), options }),
        create: (ref, value) => writes.push({ ref, value: clone(value), options: {}, create: true }),
      };
      const result = await callback(tx);
      for (const write of writes) {
        const current = documents.get(write.ref.path);
        if (write.create && current !== undefined) throw new Error('document already exists');
        documents.set(write.ref.path, write.options.merge && current
          ? { ...current, ...write.value }
          : write.value);
      }
      return result;
    },
  };
}

const baseSnapshot = {
  projectId: 'project-a',
  projection: [{ yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
  actual: [],
};
const payload = {
  weeks: [{ yearMonth: '2026-07', weekNo: 1, projection: { SALES_IN: 1200 } }],
};

function harness() {
  let nowMs = Date.parse('2026-07-12T00:00:00.000Z');
  const leasePath = `orgs/tenant-a/editLeases/${resolveEditLeaseDocumentId('cashflow', 'project-a')}`;
  const db = createDb({
    'orgs/tenant-a/members/actor-a': {
      uid: 'actor-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/members/actor-b': {
      uid: 'actor-b', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/members/actor-admin': {
      uid: 'actor-admin', role: 'admin', status: 'ACTIVE', projectIds: [],
    },
    'orgs/tenant-a/projects/project-a': { id: 'project-a', name: 'Project A', version: 3 },
    'orgs/tenant-a/cashflow_weeks/week-a': {
      projectId: 'project-a', yearMonth: '2026-07', weekNo: 1, projection: { SALES_IN: 1000 },
    },
    [leasePath]: buildActiveEditLeaseDocument({
      tenantId: 'tenant-a', resourceType: 'cashflow', resourceId: 'project-a',
      actorId: 'actor-a', actorDisplayName: 'Actor A', sessionId: 'session-a',
      leaseId: 'lease-a', serverNow: nowMs,
    }),
  });
  const auditChainService = { appendManyInTransaction: vi.fn(async () => []) };
  const service = createCashflowEditDraftService({
    db,
    now: () => new Date(nowMs).toISOString(),
    auditChainService,
    idempotencyService: createIdempotencyService(db, { now: () => new Date(nowMs) }),
    rbacPolicy: loadRbacPolicy(),
  });
  const base = {
    tenantId: 'tenant-a', actorId: 'actor-a', actorDisplayName: 'Actor A',
    actorEmail: 'actor-a@example.com', actorRole: 'pm', requestId: 'request-a',
    projectId: 'project-a', sessionId: 'session-a', leaseId: 'lease-a', fence: 1,
  };
  return {
    db, service, base, auditChainService, leasePath,
    advance: (ms) => { nowMs += ms; },
  };
}

function openDraft(h, key = 'open-a') {
  return h.service.open({ ...h.base, idempotencyKey: key, baseSnapshot, payload });
}

describe('cashflow private edit drafts', () => {
  it('matches edit-lease acquisition access for project owners without member assignment', async () => {
    for (const ownerField of ['registeredById', 'managerId']) {
      const h = harness();
      h.db.documents.set('orgs/tenant-a/members/actor-a', {
        ...h.db.documents.get('orgs/tenant-a/members/actor-a'),
        projectIds: [],
      });
      h.db.documents.set('orgs/tenant-a/projects/project-a', {
        ...h.db.documents.get('orgs/tenant-a/projects/project-a'),
        [ownerField]: 'actor-a',
      });

      const opened = await openDraft(h, `open-owner-${ownerField}`);

      expect(opened.body.draft).toMatchObject({
        projectId: 'project-a', status: 'ACTIVE', draftRevision: 0,
      });
    }
  });

  it('uses the project cashflow lease and keeps each draft invisible to other actors and admins', async () => {
    const h = harness();
    const opened = await openDraft(h);

    expect(opened).toMatchObject({
      status: 200,
      body: { draft: {
        projectId: 'project-a', resourceType: 'cashflow', resourceId: 'project-a',
        draftRevision: 0, status: 'ACTIVE', baseSnapshot, payload,
      } },
    });
    const reopened = await h.service.open({
      ...h.base,
      idempotencyKey: 'open-again',
      baseSnapshot: { projectId: 'project-a', projection: [], actual: [] },
      payload: { weeks: [] },
    });
    expect(reopened.body.draft).toMatchObject({ draftRevision: 0, baseSnapshot, payload });
    await expect(h.service.get({
      tenantId: 'tenant-a', actorId: 'actor-b', projectId: 'project-a',
    })).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    await expect(h.service.get({
      tenantId: 'tenant-a', actorId: 'actor-admin', projectId: 'project-a',
    })).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    await expect(h.service.open({
      ...h.base, actorId: 'actor-b', sessionId: 'session-b', leaseId: 'lease-b',
      idempotencyKey: 'open-b', baseSnapshot, payload,
    })).rejects.toMatchObject({ statusCode: 423, code: 'edit_lease_held' });
  });

  it('increments temporary-save revision and rejects stale writers', async () => {
    const h = harness();
    await openDraft(h);
    const saved = await h.service.update({
      ...h.base, idempotencyKey: 'save-a', expectedDraftRevision: 0,
      payload: { weeks: [{ yearMonth: '2026-07', weekNo: 1, projection: { SALES_IN: 1500 } }] },
    });

    expect(saved.body.draft).toMatchObject({ draftRevision: 1, baseSnapshot });
    await expect(h.service.update({
      ...h.base, idempotencyKey: 'save-stale', expectedDraftRevision: 0, payload,
    })).rejects.toMatchObject({ statusCode: 409, code: 'draft_version_conflict' });
  });

  it('rejects writes after the exact cashflow lease expires', async () => {
    const h = harness();
    await openDraft(h);
    await expect(h.service.update({
      ...h.base, leaseId: 'stale-lease', idempotencyKey: 'save-stale-lease',
      expectedDraftRevision: 0, payload,
    })).rejects.toMatchObject({ statusCode: 423, code: 'edit_lease_held' });
    h.advance(1_800_001);

    await expect(h.service.update({
      ...h.base, idempotencyKey: 'save-expired', expectedDraftRevision: 0, payload,
    })).rejects.toMatchObject({ statusCode: 410, code: 'edit_lease_expired' });
  });

  it('completes only after the exact JVM final release without a second canonical or lease write', async () => {
    const h = harness();
    await openDraft(h);
    await h.service.update({
      ...h.base, idempotencyKey: 'save-a', expectedDraftRevision: 0, payload,
    });
    const canonicalProject = clone(h.db.documents.get('orgs/tenant-a/projects/project-a'));
    const canonicalWeek = clone(h.db.documents.get('orgs/tenant-a/cashflow_weeks/week-a'));
    await expect(h.service.complete({
      ...h.base, idempotencyKey: 'complete-before-final', expectedDraftRevision: 1,
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_final_save_incomplete' });
    h.db.documents.set(h.leasePath, {
      ...h.db.documents.get(h.leasePath),
      state: 'RELEASED',
      releasedAt: '2026-07-12T00:00:01.000Z',
      releaseReason: 'FINAL_SAVE',
      updatedAt: '2026-07-12T00:00:01.000Z',
    });
    const releasedLease = clone(h.db.documents.get(h.leasePath));
    await expect(h.service.complete({
      ...h.base, leaseId: 'other-lease', idempotencyKey: 'complete-wrong-owner', expectedDraftRevision: 1,
    })).rejects.toMatchObject({ statusCode: 423, code: 'edit_lease_held' });

    const completed = await h.service.complete({
      ...h.base, idempotencyKey: 'complete-a', expectedDraftRevision: 1,
    });
    const replayed = await h.service.complete({
      ...h.base, idempotencyKey: 'complete-a', expectedDraftRevision: 1,
    });
    const draft = [...h.db.documents.values()].find((value) => value?.resourceType === 'cashflow' && value?.ownerUid);

    expect(completed.body).toMatchObject({
      status: 'SUBMITTED', projectId: 'project-a', draftRevision: 2,
      draft: { resourceType: 'cashflow', resourceId: 'project-a', status: 'SUBMITTED', draftRevision: 2 },
      lease: { state: 'RELEASED', canEdit: false, leaseId: 'lease-a', fence: 1 },
    });
    expect(replayed).toMatchObject({ replayed: true, body: completed.body });
    expect(draft).toMatchObject({ status: 'SUBMITTED', draftRevision: 2 });
    expect(draft).not.toHaveProperty('payload');
    expect(h.db.documents.get('orgs/tenant-a/projects/project-a')).toEqual(canonicalProject);
    expect(h.db.documents.get('orgs/tenant-a/cashflow_weeks/week-a')).toEqual(canonicalWeek);
    expect(h.db.documents.get(h.leasePath)).toEqual(releasedLease);
    expect([...h.db.documents.keys()].some((path) => path.includes('/projectRequests/'))).toBe(false);
    expect(h.auditChainService.appendManyInTransaction).toHaveBeenCalledTimes(3);
  });

  it('rejects unsafe or oversized JSON snapshots before persistence', async () => {
    const h = harness();
    const cyclic = {};
    cyclic.self = cyclic;
    await expect(h.service.open({
      ...h.base, idempotencyKey: 'open-cyclic', baseSnapshot: cyclic, payload,
    })).rejects.toMatchObject({ statusCode: 422, code: 'draft_payload_invalid' });
    await expect(h.service.open({
      ...h.base, idempotencyKey: 'open-large', baseSnapshot, payload: { value: 'x'.repeat(901 * 1024) },
    })).rejects.toMatchObject({ statusCode: 413, code: 'draft_payload_too_large' });
  });

  it('mounts the local-schema routes and forwards exact edit headers', async () => {
    const routes = [];
    const app = {
      get: (path, handler) => routes.push({ method: 'GET', path, handler }),
      post: (path, handler) => routes.push({ method: 'POST', path, handler }),
      patch: (path, handler) => routes.push({ method: 'PATCH', path, handler }),
    };
    const service = {
      get: vi.fn(),
      open: vi.fn(async () => ({ status: 200, body: { draft: {} }, replayed: false })),
      update: vi.fn(),
      complete: vi.fn(),
    };
    mountCashflowEditDraftRoutes(app, { enabled: true, cashflowEditDraftService: service });

    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/v1/cashflow-edit-drafts/:projectId',
      'POST /api/v1/cashflow-edit-drafts/:projectId/open',
      'PATCH /api/v1/cashflow-edit-drafts/:projectId',
      'POST /api/v1/cashflow-edit-drafts/:projectId/complete',
    ]);
    const route = routes[1];
    const req = {
      body: { baseSnapshot, payload }, params: { projectId: 'project-a' },
      context: {
        tenantId: 'tenant-a', actorId: 'actor-a', actorRole: 'pm', actorName: 'Actor A',
        actorEmail: 'actor-a@example.com', requestId: 'request-a', idempotencyKey: 'open-route',
      },
      header: (name) => ({
        'x-edit-session-id': 'session-a', 'x-edit-lease-id': 'lease-a', 'x-edit-fence': '1',
      })[name],
    };
    const res = { setHeader: vi.fn(), status: vi.fn(() => res), json: vi.fn() };
    const next = vi.fn();
    await route.handler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(service.open).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-a', sessionId: 'session-a', leaseId: 'lease-a', fence: 1,
      baseSnapshot, payload,
    }));
  });
});
