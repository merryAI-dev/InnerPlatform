import { describe, expect, it } from 'vitest';
import { createAuditChainService } from './audit-chain.mjs';
import {
  EDIT_LEASE_TTL_MS,
  assertOwnedInTransaction,
  createEditLeaseService,
  resolveEditLeaseDocumentId,
} from './edit-lease.mjs';
import { createIdempotencyService } from './idempotency.mjs';
import { loadRbacPolicy } from './rbac-policy.mjs';

function createDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, structuredClone(value)]));
  const versions = new Map([...documents.keys()].map((path) => [path, 1]));
  let onRead = null;
  const snapshot = (docRef) => ({
    exists: documents.has(docRef.path),
    data: () => structuredClone(documents.get(docRef.path)),
  });
  const ref = (path) => ({ path, get: async () => snapshot({ path }) });

  function write(path, value, merge = false) {
    const next = merge ? { ...(documents.get(path) || {}), ...structuredClone(value) } : structuredClone(value);
    documents.set(path, next);
    versions.set(path, (versions.get(path) || 0) + 1);
  }

  return {
    doc: ref,
    runTransaction: async (callback) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const reads = new Map();
        const writes = [];
        let writeStarted = false;
        const tx = {
          get: async (docRef) => {
            if (writeStarted) throw new Error('Firestore transaction read after write');
            reads.set(docRef.path, versions.get(docRef.path) || 0);
            const snap = snapshot(docRef);
            if (onRead) await onRead(docRef.path, snap, attempt);
            return snap;
          },
          create: (docRef, value) => {
            writeStarted = true;
            writes.push({ type: 'create', path: docRef.path, value });
          },
          set: (docRef, value, options) => {
            writeStarted = true;
            writes.push({ type: 'set', path: docRef.path, value, merge: options?.merge === true });
          },
          update: (docRef, value) => {
            writeStarted = true;
            writes.push({ type: 'set', path: docRef.path, value, merge: true });
          },
        };
        const result = await callback(tx);
        if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
        for (const operation of writes) {
          if (operation.type === 'create' && documents.has(operation.path)) {
            throw new Error(`Document already exists: ${operation.path}`);
          }
          write(operation.path, operation.value, operation.merge);
        }
        return result;
      }
      throw new Error('Transaction retry limit exceeded');
    },
    __documents: documents,
    __set: (path, value, options) => write(path, value, options?.merge === true),
    __delete: (path) => {
      documents.delete(path);
      versions.set(path, (versions.get(path) || 0) + 1);
    },
    __onRead: (callback) => { onRead = callback; },
  };
}

function createHarness({ createLeaseId } = {}) {
  let serverNow = Date.parse('2026-07-10T00:00:00.000Z');
  const leaseIds = ['lease-1', 'lease-2', 'lease-3'];
  const db = createDb({
    'orgs/tenant-a/members/actor-a': {
      uid: 'actor-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/members/actor-b': {
      uid: 'actor-b', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'],
    },
    'orgs/tenant-a/projects/project-a': { id: 'project-a' },
  });
  const auditChainService = createAuditChainService(db, { now: () => new Date(serverNow).toISOString() });
  const idempotencyService = createIdempotencyService(db, { now: () => new Date(serverNow) });
  const service = createEditLeaseService({
    db,
    now: () => serverNow,
    createLeaseId: createLeaseId || (() => leaseIds.shift()),
    auditChainService,
    idempotencyService,
    rbacPolicy: loadRbacPolicy(),
  });
  const base = {
    tenantId: 'tenant-a',
    resourceType: 'project-info',
    resourceId: 'project-a',
    actorId: 'actor-a',
    actorDisplayName: 'Actor A',
    sessionId: 'session-a',
    actorEmailEnc: 'encrypted-email',
    requestId: 'request-a',
  };

  return {
    db,
    service,
    base,
    now: () => serverNow,
    advance: (ms) => { serverNow += ms; },
  };
}

async function command(promise) {
  const outcome = await promise;
  return outcome?.body ?? outcome;
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
  it('reuses one acquire ID when Firestore retries the transaction', async () => {
    let uuidCalls = 0;
    const { db, service, base } = createHarness({
      createLeaseId: () => {
        uuidCalls += 1;
        if (uuidCalls > 1) throw new Error('lease ID supplier called more than once');
        return 'lease-retry-stable';
      },
    });
    let forcedRetry = false;
    db.__onRead(async (path, snapshot, attempt) => {
      if (!forcedRetry && attempt === 0 && path === 'orgs/tenant-a/members/actor-a') {
        forcedRetry = true;
        db.__set(path, snapshot.data());
      }
    });

    const acquired = await command(service.acquire({ ...base, idempotencyKey: 'idem-uuid-retry' }));

    expect(forcedRetry).toBe(true);
    expect(uuidCalls).toBe(1);
    expect(acquired).toMatchObject({ leaseId: 'lease-retry-stable', fence: 1, state: 'ACTIVE' });
  });

  it('rolls back lease and idempotency writes when audit append fails', async () => {
    const { db, base, now } = createHarness();
    const service = createEditLeaseService({
      db,
      now,
      createLeaseId: () => 'lease-rollback',
      rbacPolicy: loadRbacPolicy(),
      idempotencyService: createIdempotencyService(db, { now: () => new Date(now()) }),
      auditChainService: {
        appendManyInTransaction: async (tx) => {
          tx.set(db.doc('orgs/tenant-a/audit_logs/should-rollback'), { action: 'EDIT_LEASE_ACQUIRE' });
          throw new Error('audit append failed');
        },
      },
    });

    await expect(service.acquire({ ...base, idempotencyKey: 'idem-audit-rollback' }))
      .rejects.toThrow('audit append failed');

    expect([...db.__documents.keys()].some((path) => path.includes('/editLeases/'))).toBe(false);
    expect([...db.__documents.keys()].some((path) => path.includes('/audit_logs/'))).toBe(false);
    expect([...db.__documents.keys()].some((path) => path.includes('/idempotency_keys/'))).toBe(false);
  });

  it('retries on access revocation and fails closed without committing the command', async () => {
    const { db, service, base } = createHarness();
    let revoked = false;
    db.__onRead(async (path, _snapshot, attempt) => {
      if (!revoked && attempt === 0 && path === 'orgs/tenant-a/members/actor-a') {
        revoked = true;
        db.__set(path, { status: 'INACTIVE' }, { merge: true });
      }
    });

    await expectHttpError(
      service.acquire({ ...base, idempotencyKey: 'idem-access-race' }),
      403,
      'forbidden',
    );

    expect(revoked).toBe(true);
    expect([...db.__documents.keys()].some((path) => path.includes('/editLeases/'))).toBe(false);
    expect([...db.__documents.keys()].some((path) => path.includes('/audit_logs/'))).toBe(false);
    expect([...db.__documents.keys()].some((path) => path.includes('/idempotency_keys/'))).toBe(false);
  });

  it('retries when draft ownership changes and preserves private not-found semantics', async () => {
    const { db, service, base } = createHarness();
    const draftPath = 'orgs/tenant-a/projectRequestDrafts/draft-a';
    db.__set(draftPath, { ownerUid: 'actor-a' });
    let ownerChanged = false;
    db.__onRead(async (path, _snapshot, attempt) => {
      if (!ownerChanged && attempt === 0 && path === draftPath) {
        ownerChanged = true;
        db.__set(path, { ownerUid: 'actor-b' });
      }
    });

    await expectHttpError(
      service.acquire({
        ...base,
        resourceType: 'project-registration',
        resourceId: 'draft-a',
        idempotencyKey: 'idem-draft-owner-race',
      }),
      404,
      'not_found',
    );

    expect(ownerChanged).toBe(true);
    expect([...db.__documents.keys()].some((path) => path.includes('/editLeases/'))).toBe(false);
  });

  it('retries when the project is deleted and fails closed without a lease', async () => {
    const { db, service, base } = createHarness();
    const projectPath = 'orgs/tenant-a/projects/project-a';
    let deleted = false;
    db.__onRead(async (path, _snapshot, attempt) => {
      if (!deleted && attempt === 0 && path === projectPath) {
        deleted = true;
        db.__delete(path);
      }
    });

    await expectHttpError(
      service.acquire({ ...base, idempotencyKey: 'idem-project-delete-race' }),
      404,
      'not_found',
    );

    expect(deleted).toBe(true);
    expect([...db.__documents.keys()].some((path) => path.includes('/editLeases/'))).toBe(false);
  });

  it('uses the persisted member role and project assignment in the lease transaction', async () => {
    const { db, service, base } = createHarness();
    const memberPath = 'orgs/tenant-a/members/actor-a';
    db.__set(memberPath, {
      uid: 'actor-a', role: 'pm', status: 'ACTIVE', portalProfile: { projectIds: ['project-a'] },
    });
    await expect(service.getStatus(base)).resolves.toMatchObject({ state: 'AVAILABLE' });

    db.__set(memberPath, {
      uid: 'actor-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-b'],
    });
    await expectHttpError(service.getStatus(base), 403, 'forbidden');

    db.__set('orgs/tenant-a/projects/project-a', { id: 'project-a', managerId: 'actor-a' });
    await expect(service.getStatus(base)).resolves.toMatchObject({ state: 'AVAILABLE' });

    db.__set(memberPath, { uid: 'actor-a', role: 'finance', status: 'ACTIVE' });
    await expect(service.getStatus(base)).resolves.toMatchObject({ state: 'AVAILABLE' });
  });

  it('accepts legacy ownerId only for the current draft owner', async () => {
    const { db, service, base } = createHarness();
    const input = {
      ...base,
      resourceType: 'project-registration',
      resourceId: 'draft-a',
    };
    db.__set('orgs/tenant-a/projectRequestDrafts/draft-a', { ownerId: 'actor-b' });
    await expectHttpError(service.getStatus(input), 404, 'not_found');

    db.__set('orgs/tenant-a/projectRequestDrafts/draft-a', { ownerId: 'actor-a' });
    await expect(service.getStatus(input)).resolves.toMatchObject({ state: 'AVAILABLE' });
  });

  it('does not acquire a registration lease for a submitted draft', async () => {
    const { db, service, base } = createHarness();
    db.__set('orgs/tenant-a/projectRequestDrafts/draft-a', {
      ownerUid: 'actor-a',
      status: 'SUBMITTED',
    });

    await expectHttpError(
      service.acquire({
        ...base,
        resourceType: 'project-registration',
        resourceId: 'draft-a',
        idempotencyKey: 'idem-submitted-draft-acquire',
      }),
      409,
      'draft_not_active',
    );
    expect([...db.__documents.keys()].some((path) => path.includes('/editLeases/'))).toBe(false);
  });

  it('uses an exact 1,800,000ms server-owned TTL', async () => {
    const { service, base, now } = createHarness();

    const acquired = await command(service.acquire(base));

    expect(EDIT_LEASE_TTL_MS).toBe(1_800_000);
    expect(Date.parse(acquired.expiresAt) - Date.parse(acquired.serverNow)).toBe(1_800_000);
    expect(Date.parse(acquired.serverNow)).toBe(now());
    expect(acquired).toMatchObject({ state: 'ACTIVE', canEdit: true, leaseId: 'lease-1', fence: 1 });
  });

  it('returns the existing lease for the same actor and session without renewing it', async () => {
    const { service, base, advance } = createHarness();
    const first = await command(service.acquire(base));
    advance(60_000);

    const second = await command(service.acquire(base));

    expect(second).toMatchObject({ leaseId: first.leaseId, fence: first.fence, expiresAt: first.expiresAt });
  });

  it('status for another holder exposes only the safe holder projection', async () => {
    const { service, base } = createHarness();
    await command(service.acquire(base));

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
    await command(service.acquire(base));

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
    const first = await command(service.acquire(base));
    advance(EDIT_LEASE_TTL_MS);

    const second = await command(service.acquire({
      ...base, actorId: 'actor-b', actorDisplayName: 'Actor B', sessionId: 'session-b',
    }));

    expect(first).toMatchObject({ leaseId: 'lease-1', fence: 1 });
    expect(second).toMatchObject({ leaseId: 'lease-2', fence: 2, state: 'ACTIVE', canEdit: true });
  });

  it('reports exact-boundary leases as expired', async () => {
    const { service, base, advance } = createHarness();
    await command(service.acquire(base));
    advance(EDIT_LEASE_TTL_MS);

    await expect(service.getStatus(base)).resolves.toMatchObject({
      state: 'EXPIRED',
      canEdit: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
    });
  });

  it('records effective expiry separately from the later observation time', async () => {
    const { db, service, base, advance } = createHarness();
    const acquired = await command(service.acquire(base));
    advance(EDIT_LEASE_TTL_MS + 15_000);

    await expect(service.getStatus(base)).resolves.toMatchObject({ state: 'EXPIRED' });

    const leasePath = `orgs/${base.tenantId}/editLeases/${resolveEditLeaseDocumentId(base.resourceType, base.resourceId)}`;
    const expired = db.__documents.get(leasePath);
    expect(expired).toMatchObject({
      expiredAt: acquired.expiresAt,
      expiryObservedAt: '2026-07-10T00:30:15.000Z',
    });
    const expireAudit = [...db.__documents.entries()]
      .find(([path, entry]) => path.includes('/audit_logs/') && entry.action === 'EDIT_LEASE_EXPIRE')?.[1];
    expect(expireAudit?.metadata).toMatchObject({
      effectiveExpiresAt: acquired.expiresAt,
      expiryObservedAt: '2026-07-10T00:30:15.000Z',
    });
  });

  it('only extend renews an active lease owned by the exact actor/session/lease/fence', async () => {
    const { service, base, advance } = createHarness();
    const acquired = await command(service.acquire(base));
    advance(60_000);

    const extended = await command(service.extend({ ...base, leaseId: acquired.leaseId, fence: acquired.fence }));

    expect(Date.parse(extended.expiresAt) - Date.parse(extended.serverNow)).toBe(EDIT_LEASE_TTL_MS);
    await expectHttpError(
      service.extend({ ...base, leaseId: 'stale-lease', fence: acquired.fence }),
      423,
      'edit_lease_held',
    );
  });

  it('rejects extension at expiry', async () => {
    const { db, service, base, advance } = createHarness();
    const acquired = await command(service.acquire(base));
    advance(EDIT_LEASE_TTL_MS);

    await expectHttpError(
      service.extend({ ...base, leaseId: acquired.leaseId, fence: acquired.fence }),
      410,
      'edit_lease_expired',
    );
    const leasePath = `orgs/${base.tenantId}/editLeases/${resolveEditLeaseDocumentId(base.resourceType, base.resourceId)}`;
    expect(db.__documents.get(leasePath)).toMatchObject({ state: 'EXPIRED', lastExpiredFence: acquired.fence });
    const expireAudits = [...db.__documents.entries()].filter(([path, entry]) => (
      path.includes('/audit_logs/') && entry.action === 'EDIT_LEASE_EXPIRE'
    ));
    expect(expireAudits).toHaveLength(1);

    await expectHttpError(
      service.extend({ ...base, leaseId: acquired.leaseId, fence: acquired.fence }),
      410,
      'edit_lease_expired',
    );
    expect([...db.__documents.entries()].filter(([path, entry]) => (
      path.includes('/audit_logs/') && entry.action === 'EDIT_LEASE_EXPIRE'
    ))).toHaveLength(1);
  });

  it('releases explicitly and the next acquire rotates leaseId and fence', async () => {
    const { service, base } = createHarness();
    const acquired = await command(service.acquire(base));

    const released = await command(service.release({ ...base, leaseId: acquired.leaseId, fence: acquired.fence }));
    const next = await command(service.acquire({ ...base, sessionId: 'session-b' }));

    expect(released).toMatchObject({ state: 'RELEASED', canEdit: false });
    expect(next).toMatchObject({ state: 'ACTIVE', canEdit: true, leaseId: 'lease-2', fence: 2 });
  });

  it('assertOwnedInTransaction rejects stale and expired writes in the caller transaction', async () => {
    const { db, service, base, advance, now } = createHarness();
    const acquired = await command(service.acquire(base));
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
