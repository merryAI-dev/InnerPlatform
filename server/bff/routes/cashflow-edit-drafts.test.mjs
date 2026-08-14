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
    collection: (path) => ({
      where: (field, operator, value) => ({
        queryPath: path,
        field,
        operator,
        value,
      }),
    }),
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: async (ref) => {
          if (ref.queryPath) {
            const prefix = `${ref.queryPath}/`;
            const docs = [...documents.entries()]
              .filter(([path, value]) => path.startsWith(prefix)
                && !path.slice(prefix.length).includes('/')
                && ref.operator === '==' && value?.[ref.field] === ref.value)
              .map(([path, value]) => ({ id: path.slice(prefix.length), data: () => clone(value) }));
            return { docs };
          }
          return snapshot(ref.path);
        },
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
const cumulativeRootHash = `sha256:${'a'.repeat(64)}`;

function cumulativeCloseHead(overrides = {}) {
  return {
    contractVersion: 'cashflow-cumulative-close-v2',
    tenantId: 'tenant-a',
    projectId: 'project-a',
    status: 'CLOSED',
    fromMonth: '2023-01',
    closedThrough: '2026-07',
    settlementMonth: '2026-08',
    rootHash: cumulativeRootHash,
    revision: 1,
    ...overrides,
  };
}

function harness() {
  let nowMs = Date.parse('2026-07-12T00:00:00.000Z');
  const leasePath = `orgs/tenant-a/editLeases/${resolveEditLeaseDocumentId('cashflow', 'project-a')}`;
  const db = createDb({
    'orgs/tenant-a/members/actor-a': {
      uid: 'actor-a', name: 'Actor A', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/members/actor-b': {
      uid: 'actor-b', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/members/actor-admin': {
      uid: 'actor-admin', name: 'Finance Admin', role: 'admin', status: 'ACTIVE', projectIds: [],
    },
    'orgs/tenant-a/members/actor-viewer': {
      uid: 'actor-viewer', name: 'Viewer', role: 'viewer', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/projects/project-a': { id: 'project-a', name: 'Project A', version: 3 },
    'orgs/tenant-a/cashflow_sheet_mirrors/project-a': { projectId: 'project-a', weeklyYear: 2026 },
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
  it('keeps a stored viewer role read-only even though legacy role normalization maps viewer to PM', async () => {
    const h = harness();
    await expect(h.service.open({
      ...h.base,
      actorId: 'actor-viewer',
      sessionId: 'viewer-session',
      leaseId: 'viewer-lease',
      idempotencyKey: 'viewer-open',
      baseSnapshot,
      payload,
    })).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });
  });

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

  it('starts a new ACTIVE draft after an approved reopen instead of reviving the submitted payload', async () => {
    const h = harness();
    await openDraft(h);
    const [draftPath, activeDraft] = [...h.db.documents.entries()].find(([, value]) => (
      value?.resourceType === 'cashflow' && value?.ownerUid === 'actor-a'
    ));
    h.db.documents.set(draftPath, {
      ownerUid: activeDraft.ownerUid,
      tenantId: activeDraft.tenantId,
      resourceType: activeDraft.resourceType,
      resourceId: activeDraft.resourceId,
      draftRevision: 1,
      status: 'SUBMITTED',
      createdAt: activeDraft.createdAt,
      updatedAt: '2026-07-12T00:00:01.000Z',
      submittedAt: '2026-07-12T00:00:01.000Z',
    });
    h.db.documents.set('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-07', {
      requestId: 'project-a-2026-07', tenantId: 'tenant-a', projectId: 'project-a',
      yearMonth: '2026-07', status: 'REOPENED', revision: 3,
    });
    const nextLease = buildActiveEditLeaseDocument({
      tenantId: 'tenant-a', resourceType: 'cashflow', resourceId: 'project-a',
      actorId: 'actor-a', actorDisplayName: 'Actor A', sessionId: 'session-next',
      leaseId: 'lease-next', serverNow: Date.parse('2026-07-12T00:00:02.000Z'),
      existing: h.db.documents.get(h.leasePath),
    });
    h.db.documents.set(h.leasePath, nextLease);
    const nextPayload = { monthClose: { yearMonth: '2026-07' } };

    const reopened = await h.service.open({
      ...h.base,
      sessionId: 'session-next',
      leaseId: 'lease-next',
      fence: nextLease.fence,
      idempotencyKey: 'open-after-approved-reopen',
      baseSnapshot,
      payload: nextPayload,
    });

    expect(reopened.body.draft).toMatchObject({
      status: 'ACTIVE', draftRevision: 0, baseSnapshot, payload: nextPayload,
    });
    expect(h.db.documents.get(draftPath)).toMatchObject({
      status: 'ACTIVE', draftRevision: 0, payload: nextPayload,
    });
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

  it('blocks month-close private drafts from the cumulative close head', async () => {
    const closeHead = cumulativeCloseHead();
    const monthClosePayload = { monthClose: { yearMonth: '2026-07' } };

    const openHarness = harness();
    openHarness.db.documents.set('orgs/tenant-a/cashflow_cumulative_close_heads/project-a', closeHead);
    await expect(openHarness.service.open({
      ...openHarness.base, idempotencyKey: 'open-closed-range', baseSnapshot,
      payload: monthClosePayload,
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_locked' });

    const updateHarness = harness();
    await updateHarness.service.open({
      ...updateHarness.base, idempotencyKey: 'open-month-before-close', baseSnapshot,
      payload: monthClosePayload,
    });
    updateHarness.db.documents.set('orgs/tenant-a/cashflow_cumulative_close_heads/project-a', closeHead);
    await expect(updateHarness.service.update({
      ...updateHarness.base, idempotencyKey: 'update-closed-month', expectedDraftRevision: 0,
      payload: {},
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_locked' });

    updateHarness.db.documents.set(updateHarness.leasePath, {
      ...updateHarness.db.documents.get(updateHarness.leasePath),
      state: 'RELEASED', releaseReason: 'FINAL_SAVE',
      releasedAt: '2026-07-12T00:00:01.000Z', updatedAt: '2026-07-12T00:00:01.000Z',
    });
    await expect(updateHarness.service.complete({
      ...updateHarness.base, idempotencyKey: 'complete-closed-month', expectedDraftRevision: 0,
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_locked' });
  });

  it('uses closedThrough instead of the settlement month or approval request state', async () => {
    const laterMonth = harness();
    laterMonth.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead(),
    );
    laterMonth.db.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-08', {
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-08', status: 'CLOSED',
    });
    laterMonth.db.documents.set('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08', {
      requestId: 'project-a-2026-08', tenantId: 'tenant-a', projectId: 'project-a',
      yearMonth: '2026-08', status: 'APPROVED', revision: 1,
    });
    await expect(laterMonth.service.open({
      ...laterMonth.base,
      idempotencyKey: 'later-settlement-month',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-08' } },
    })).resolves.toMatchObject({ status: 200 });

    const closedRange = harness();
    closedRange.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead(),
    );
    closedRange.db.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-07', {
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-07', status: 'OPEN',
    });
    closedRange.db.documents.set('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-07', {
      requestId: 'project-a-2026-07', tenantId: 'tenant-a', projectId: 'project-a',
      yearMonth: '2026-07', status: 'REOPENED', revision: 3,
    });
    await expect(closedRange.service.open({
      ...closedRange.base,
      idempotencyKey: 'closed-through-wins',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-07' } },
    }))
      .rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_locked' });
  });

  it('limits cumulative month authority to the canonical head year', async () => {
    const annualYear = harness();
    annualYear.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead(),
    );

    await expect(annualYear.service.open({
      ...annualYear.base,
      idempotencyKey: 'annual-year-outside-month-authority',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2025-12' } },
    })).resolves.toMatchObject({ status: 200 });

    const driftedMirror = harness();
    driftedMirror.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead(),
    );
    driftedMirror.db.documents.set('orgs/tenant-a/cashflow_sheet_mirrors/project-a', {
      projectId: 'project-a', weeklyYear: 2027,
    });
    await expect(driftedMirror.service.open({
      ...driftedMirror.base,
      idempotencyKey: 'drifted-mirror-cannot-reopen-closed-head-month',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-07' } },
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_locked' });

    const missingGrain = harness();
    missingGrain.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead(),
    );
    missingGrain.db.documents.delete('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
    await expect(missingGrain.service.open({
      ...missingGrain.base,
      idempotencyKey: 'missing-weekly-year-authority',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-08' } },
    })).resolves.toMatchObject({ status: 200 });
  });

  it('keeps a January settlement from turning the previous annual year into monthly authority', async () => {
    const h = harness();
    h.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead({ settlementMonth: '2026-01', closedThrough: '2025-12' }),
    );

    await expect(h.service.open({
      ...h.base,
      idempotencyKey: 'january-settlement-does-not-lock-annual-year',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2025-12' } },
    })).resolves.toMatchObject({ status: 200 });
  });

  it.each([
    ['contractVersion', { contractVersion: 'legacy' }],
    ['tenantId', { tenantId: 'tenant-b' }],
    ['projectId', { projectId: 'project-b' }],
    ['status', { status: 'OPEN' }],
    ['settlementMonth missing', { settlementMonth: '' }],
    ['settlementMonth malformed', { settlementMonth: '2026-8' }],
    ['settlementMonth mismatch', { settlementMonth: '2026-09' }],
    ['closedThrough', { closedThrough: '2026-13' }],
    ['rootHash', { rootHash: 'sha256:broken' }],
    ['revision', { revision: 0 }],
  ])('fails closed when cumulative authority %s is invalid', async (_field, override) => {
    const h = harness();
    h.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead(override),
    );
    await expect(h.service.open({
      ...h.base,
      idempotencyKey: `invalid-head-${_field}`,
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-08' } },
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'cashflow_month_close_contract_invalid',
      message: expect.not.stringMatching(/Cashflow|Stored|Firestore|revision/i),
    });
  });

  it.each([
    ['legacy', {}],
    ['canonical', { contractVersion: 'cashflow-month-close-v1', revision: 0, reopenCount: 0 }],
  ])('allows a genuinely pristine %s OPEN run without authority', async (_kind, contract) => {
    const h = harness();
    h.db.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-07', {
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-07', status: 'OPEN',
      ...contract,
    });

    await expect(h.service.open({
      ...h.base,
      idempotencyKey: `pristine-open-${_kind}`,
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-07' } },
    })).resolves.toMatchObject({ status: 200 });
  });

  it('keeps a requested reopen head authoritative until the canonical decision', async () => {
    const h = harness();
    h.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead({ status: 'REOPEN_REQUESTED', revision: 2 }),
    );
    await expect(h.service.open({
      ...h.base,
      idempotencyKey: 'reopen-requested-head',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-07' } },
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_locked' });
  });

  it('requires migration when legacy close history has no cumulative authority head', async () => {
    const legacy = harness();
    legacy.db.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-07', {
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-07', status: 'CLOSED',
    });
    await expect(legacy.service.open({
      ...legacy.base,
      idempotencyKey: 'legacy-close-without-head',
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-07' } },
    }))
      .rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_close_migration_required' });
  });

  it.each([
    ['revision', { revision: 1 }],
    ['reopen', { reopenCount: 1 }],
    ['snapshot', { snapshot: { version: 1 } }],
    ['closed', { closedAt: '2026-07-31T15:00:00Z' }],
    ['amendment', { lastAmendmentEvidence: { sourceRevision: 'sha256:legacy' } }],
    ['reopen reason', { reopenReason: '다시 확인이 필요합니다.' }],
    ['reopen requested at', { reopenRequestedAt: '2026-08-14T10:00:00Z' }],
    ['reopen requester', { reopenRequestedByUid: 'people-a' }],
    ['reopen decision reason', { reopenDecisionReason: '수정 후 재결산' }],
    ['reopen decided at', { reopenDecidedAt: '2026-08-14T11:00:00Z' }],
    ['reopen decider', { reopenDecidedByUid: 'people-admin' }],
  ])('requires migration when an OPEN run retains %s evidence without authority', async (_kind, evidence) => {
    const h = harness();
    h.db.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-07', {
      contractVersion: 'cashflow-month-close-v1',
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-07', status: 'OPEN',
      revision: 0, reopenCount: 0, ...evidence,
    });

    await expect(h.service.open({
      ...h.base,
      idempotencyKey: `historical-open-${_kind}`,
      baseSnapshot,
      payload: { monthClose: { yearMonth: '2026-07' } },
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'cashflow_month_close_migration_required',
    });
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

  it('merges only whitelisted weekly status intent fields under the project lease', async () => {
    const h = harness();
    const saved = await h.service.applyWeeklySubmissionStatusIntent({
      ...h.base, idempotencyKey: 'weekly-status-1', yearMonth: '2026-07', weekNo: 1,
      expectedRevision: 0,
      changes: { projectionUpdated: true, expenseSyncState: 'review_required', expenseReviewPendingCount: 2 },
    });

    expect(saved.body.status).toMatchObject({
      id: 'project-a-2026-07-w1', tenantId: 'tenant-a', projectId: 'project-a',
      yearMonth: '2026-07', weekNo: 1, statusRevision: 1,
      projectionUpdated: true,
      projectionUpdatedAt: '2026-07-12T00:00:00.000Z',
      projectionUpdatedByName: 'Actor A',
      expenseSyncState: 'review_required',
      expenseReviewPendingCount: 2,
    });
    const stored = h.db.documents.get('orgs/tenant-a/weekly_submission_status/project-a-2026-07-w1');
    expect(stored).toEqual(saved.body.status);
    expect(stored).not.toHaveProperty('amounts');
    await expect(h.service.applyWeeklySubmissionStatusIntent({
      ...h.base, idempotencyKey: 'weekly-status-stale', yearMonth: '2026-07', weekNo: 1,
      expectedRevision: 0, changes: { projectionUpdated: false },
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_metadata_version_conflict' });
  });

  it('locks weekly status writes only inside the cumulative closedThrough boundary', async () => {
    const h = harness();
    h.db.documents.set(
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a',
      cumulativeCloseHead(),
    );

    await expect(h.service.applyWeeklySubmissionStatusIntent({
      ...h.base, idempotencyKey: 'weekly-status-closed-through', yearMonth: '2026-07', weekNo: 1,
      expectedRevision: 0, changes: { projectionUpdated: true },
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_month_locked' });
    expect(h.db.documents.has(
      'orgs/tenant-a/weekly_submission_status/project-a-2026-07-w1',
    )).toBe(false);
    expect(h.auditChainService.appendManyInTransaction).not.toHaveBeenCalled();
  });

  it('replaces the project evidence-required map with revision fencing and server audit metadata', async () => {
    const h = harness();
    h.db.documents.set('orgs/tenant-a/budget_evidence_maps/project-a', {
      tenantId: 'tenant-a', projectId: 'project-a', map: { '기존|항목': '영수증' }, evidenceMapRevision: 2,
    });

    const saved = await h.service.applyEvidenceRequiredMapIntent({
      ...h.base, idempotencyKey: 'evidence-map-1', expectedRevision: 2,
      map: { '사업비|교통비': '카드 영수증', '인건비|급여': '급여대장' },
    });

    expect(saved.body.evidenceRequiredMap).toEqual({
      tenantId: 'tenant-a', projectId: 'project-a',
      map: { '사업비|교통비': '카드 영수증', '인건비|급여': '급여대장' },
      evidenceMapRevision: 3,
      updatedAt: '2026-07-12T00:00:00.000Z',
      updatedBy: 'Actor A',
    });
    expect(h.db.documents.get('orgs/tenant-a/budget_evidence_maps/project-a')).toEqual(saved.body.evidenceRequiredMap);
    await expect(h.service.applyEvidenceRequiredMapIntent({
      ...h.base, idempotencyKey: 'evidence-map-stale', expectedRevision: 2, map: {},
    })).rejects.toMatchObject({ statusCode: 409, code: 'cashflow_metadata_version_conflict' });
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
      applyWeeklySubmissionStatusIntent: vi.fn(),
      applyEvidenceRequiredMapIntent: vi.fn(),
    };
    mountCashflowEditDraftRoutes(app, { enabled: true, cashflowEditDraftService: service });

    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/v1/cashflow-edit-drafts/:projectId',
      'POST /api/v1/cashflow-edit-drafts/:projectId/open',
      'PATCH /api/v1/cashflow-edit-drafts/:projectId',
      'POST /api/v1/cashflow-edit-drafts/:projectId/complete',
      'POST /api/v1/cashflow-metadata/:projectId/weekly-submission-status',
      'POST /api/v1/cashflow-metadata/:projectId/evidence-required-map',
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

    service.open.mockClear();
    const financeNext = vi.fn();
    await route.handler({
      ...req,
      context: { ...req.context, actorRole: 'finance' },
    }, res, financeNext);
    expect(financeNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'forbidden' }));
    expect(service.open).not.toHaveBeenCalled();
  });
});
