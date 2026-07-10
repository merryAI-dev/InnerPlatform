import { describe, expect, it } from 'vitest';
import {
  EDIT_LEASE_TTL_MS,
  assertOwnedInTransaction,
  createEditLeaseService,
  resolveEditLeaseDocumentId,
} from './edit-lease.mjs';

function createDb() {
  const documents = new Map();
  const snapshot = (docRef) => ({
    exists: documents.has(docRef.path),
    data: () => documents.get(docRef.path),
  });
  const ref = (path) => ({ path, get: async () => snapshot({ path }) });

  return {
    doc: ref,
    runTransaction: async (callback) => callback({
      get: async (docRef) => snapshot(docRef),
      set: (docRef, value) => documents.set(docRef.path, structuredClone(value)),
    }),
    __documents: documents,
  };
}

function createHarness() {
  let serverNow = Date.parse('2026-07-10T00:00:00.000Z');
  const leaseIds = ['lease-1', 'lease-2', 'lease-3'];
  const db = createDb();
  const service = createEditLeaseService({
    db,
    now: () => serverNow,
    createLeaseId: () => leaseIds.shift(),
  });
  const base = {
    tenantId: 'tenant-a',
    resourceType: 'project-info',
    resourceId: 'project-a',
    actorId: 'actor-a',
    actorDisplayName: 'Actor A',
    sessionId: 'session-a',
  };

  return {
    db,
    service,
    base,
    now: () => serverNow,
    advance: (ms) => { serverNow += ms; },
  };
}

async function expectHttpError(promise, statusCode, code) {
  try {
    await promise;
  } catch (error) {
    expect(error).toMatchObject({ statusCode, code });
    return error;
  }
  throw new Error(`Expected ${statusCode} ${code}`);
}

describe('edit lease service', () => {
  it('uses an exact 1,800,000ms server-owned TTL', async () => {
    const { service, base, now } = createHarness();

    const acquired = await service.acquire(base);

    expect(EDIT_LEASE_TTL_MS).toBe(1_800_000);
    expect(Date.parse(acquired.expiresAt) - Date.parse(acquired.serverNow)).toBe(1_800_000);
    expect(Date.parse(acquired.serverNow)).toBe(now());
    expect(acquired).toMatchObject({ state: 'ACTIVE', canEdit: true, leaseId: 'lease-1', fence: 1 });
  });

  it('returns the existing lease for the same actor and session without renewing it', async () => {
    const { service, base, advance } = createHarness();
    const first = await service.acquire(base);
    advance(60_000);

    const second = await service.acquire(base);

    expect(second).toMatchObject({ leaseId: first.leaseId, fence: first.fence, expiresAt: first.expiresAt });
  });

  it('status for another holder exposes only the safe holder projection', async () => {
    const { service, base } = createHarness();
    await service.acquire(base);

    const status = await service.getStatus({
      ...base,
      actorId: 'actor-b',
      actorDisplayName: 'Actor B',
      sessionId: 'session-b',
    });

    expect(status).toEqual({
      serverNow: '2026-07-10T00:00:00.000Z',
      state: 'ACTIVE',
      canEdit: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
      holderDisplayName: 'Actor A',
      sameActor: false,
    });
    expect(JSON.stringify(status)).not.toMatch(/actor-a|session-a|lease-1|fence|@/i);
  });

  it('rejects another session while active, including another tab for the same actor', async () => {
    const { service, base } = createHarness();
    await service.acquire(base);

    const error = await expectHttpError(
      service.acquire({ ...base, sessionId: 'session-b' }),
      423,
      'edit_lease_held',
    );

    expect(error.publicDetails).toEqual({
      holderDisplayName: 'Actor A',
      sameActor: true,
      expiresAt: '2026-07-10T00:30:00.000Z',
    });
    expect(JSON.stringify(error.publicDetails)).not.toMatch(/actor-a|session-a|lease-1|fence/i);
  });

  it('treats now equal to expiresAt as expired and reacquires with a new lease and fence', async () => {
    const { service, base, advance } = createHarness();
    const first = await service.acquire(base);
    advance(EDIT_LEASE_TTL_MS);

    const second = await service.acquire({ ...base, actorId: 'actor-b', actorDisplayName: 'Actor B', sessionId: 'session-b' });

    expect(first).toMatchObject({ leaseId: 'lease-1', fence: 1 });
    expect(second).toMatchObject({ leaseId: 'lease-2', fence: 2, state: 'ACTIVE', canEdit: true });
  });

  it('reports exact-boundary leases as expired', async () => {
    const { service, base, advance } = createHarness();
    await service.acquire(base);
    advance(EDIT_LEASE_TTL_MS);

    await expect(service.getStatus(base)).resolves.toMatchObject({
      state: 'EXPIRED',
      canEdit: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
    });
  });

  it('only extend renews an active lease owned by the exact actor/session/lease/fence', async () => {
    const { service, base, advance } = createHarness();
    const acquired = await service.acquire(base);
    advance(60_000);

    const extended = await service.extend({ ...base, leaseId: acquired.leaseId, fence: acquired.fence });

    expect(Date.parse(extended.expiresAt) - Date.parse(extended.serverNow)).toBe(EDIT_LEASE_TTL_MS);
    await expectHttpError(
      service.extend({ ...base, leaseId: 'stale-lease', fence: acquired.fence }),
      423,
      'edit_lease_held',
    );
  });

  it('rejects extension at expiry', async () => {
    const { service, base, advance } = createHarness();
    const acquired = await service.acquire(base);
    advance(EDIT_LEASE_TTL_MS);

    await expectHttpError(
      service.extend({ ...base, leaseId: acquired.leaseId, fence: acquired.fence }),
      410,
      'edit_lease_expired',
    );
  });

  it('releases explicitly and the next acquire rotates leaseId and fence', async () => {
    const { service, base } = createHarness();
    const acquired = await service.acquire(base);

    const released = await service.release({ ...base, leaseId: acquired.leaseId, fence: acquired.fence });
    const next = await service.acquire({ ...base, sessionId: 'session-b' });

    expect(released).toMatchObject({ state: 'RELEASED', canEdit: false });
    expect(next).toMatchObject({ state: 'ACTIVE', canEdit: true, leaseId: 'lease-2', fence: 2 });
  });

  it('assertOwnedInTransaction rejects stale and expired writes in the caller transaction', async () => {
    const { db, service, base, advance, now } = createHarness();
    const acquired = await service.acquire(base);
    const ref = db.doc(`orgs/${base.tenantId}/editLeases/${resolveEditLeaseDocumentId(base.resourceType, base.resourceId)}`);

    await db.runTransaction((tx) => assertOwnedInTransaction({
      tx,
      leaseRef: ref,
      ...base,
      leaseId: acquired.leaseId,
      fence: acquired.fence,
      serverNow: now(),
    }));
    await expectHttpError(
      db.runTransaction((tx) => assertOwnedInTransaction({
        tx,
        leaseRef: ref,
        ...base,
        leaseId: acquired.leaseId,
        fence: acquired.fence + 1,
        serverNow: now(),
      })),
      423,
      'edit_lease_held',
    );

    advance(EDIT_LEASE_TTL_MS);
    await expectHttpError(
      db.runTransaction((tx) => assertOwnedInTransaction({
        tx,
        leaseRef: ref,
        ...base,
        leaseId: acquired.leaseId,
        fence: acquired.fence,
        serverNow: now(),
      })),
      410,
      'edit_lease_expired',
    );
  });

  it('allows only supported resource types and derives collision-free document IDs', async () => {
    const { service, base } = createHarness();

    const slashId = resolveEditLeaseDocumentId('project-info', 'a/b');
    expect(slashId).not.toBe(resolveEditLeaseDocumentId('project-info', 'a%2Fb'));
    expect(slashId).not.toContain('/');
    await expectHttpError(
      service.acquire({ ...base, resourceType: 'unknown' }),
      400,
      'edit_lease_resource_invalid',
    );
  });
});
