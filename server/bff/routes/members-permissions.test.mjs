import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildMemberPermissionOverview, mountMemberRoutes } from './members.mjs';

function memberEntry({ uid, role, status = 'ACTIVE', projectIds = [], disabled = false }) {
  return {
    authUid: uid,
    authDisabled: disabled,
    effectiveRole: role,
    canonicalMember: {
      docId: uid,
      uid,
      data: { uid, role, status, projectIds },
    },
    legacyMembers: [],
  };
}

const projects = [
  { id: 'p-assigned', name: '배정 사업', registeredById: 'pm-a', managerId: 'pm-a', executiveApproverId: 'head-a' },
  { id: 'p-head', name: '조직장 사업', registeredById: 'pm-b', managerId: 'pm-b', executiveApproverId: 'head-a' },
];

describe('member permission overview', () => {
  it('shows project-access close requests and designated organization-head approvals separately', () => {
    expect(buildMemberPermissionOverview(
      memberEntry({ uid: 'head-a', role: 'viewer' }),
      projects,
    )).toEqual({
      isActive: true,
      accessibleProjects: [
        { id: 'p-assigned', name: '배정 사업' },
        { id: 'p-head', name: '조직장 사업' },
      ],
      organizationHeadProjects: [
        { id: 'p-assigned', name: '배정 사업' },
        { id: 'p-head', name: '조직장 사업' },
      ],
      canRequestCashflowClose: true,
      canApproveProjectRegistration: true,
      canDecideCashflowReopen: true,
    });
  });

  it('grants reopen decisions to an exact active runtime admin, not an unrelated finance member', () => {
    expect(buildMemberPermissionOverview(
      memberEntry({ uid: 'finance-a', role: 'finance' }),
      projects,
    )).toMatchObject({
      isActive: true,
      canRequestCashflowClose: true,
      canApproveProjectRegistration: false,
      canDecideCashflowReopen: false,
    });
    expect(buildMemberPermissionOverview(
      memberEntry({ uid: 'admin-a', role: 'admin' }),
      projects,
    )).toMatchObject({
      isActive: true,
      canDecideCashflowReopen: true,
    });
    expect(buildMemberPermissionOverview(
      memberEntry({ uid: 'finance-a', role: 'finance', status: 'INACTIVE' }),
      projects,
    )).toMatchObject({
      isActive: false,
      canRequestCashflowClose: false,
      canDecideCashflowReopen: false,
    });
  });

  it('does not infer runtime authority from a mismatched canonical member document', () => {
    const entry = memberEntry({ uid: 'admin-a', role: 'admin' });
    entry.canonicalMember.docId = 'legacy-admin';

    expect(buildMemberPermissionOverview(entry, projects)).toMatchObject({
      isActive: false,
      canDecideCashflowReopen: false,
    });
  });
});

function createRoleHarness({
  patch = {}, failAudit = false, failAuditEntityId = '', failClaims = false, extraAuthUsers = [],
  failOuterCompleteOnce = false,
} = {}) {
  const store = new Map(Object.entries({
    'orgs/tenant-a/members/admin-1': {
      uid: 'admin-1', email: 'admin@example.com', role: 'admin', status: 'ACTIVE',
    },
    'orgs/tenant-a/members/target-1': {
      uid: 'target-1', email: 'target@example.com', role: 'pm', status: 'ACTIVE',
    },
    'orgs/tenant-a/persons/person-target-1': { personId: 'person-target-1', uid: 'target-1' },
    ...patch,
  }));
  const audits = [];
  const claimsCalls = [];

  function doc(path) {
    return {
      path,
      async get() {
        return { id: path.split('/').at(-1), exists: store.has(path), data: () => store.get(path) };
      },
      async set(value, options) {
        const current = store.get(path) || {};
        store.set(path, options?.merge ? { ...current, ...value } : value);
      },
    };
  }

  function collection(path, filters = [], max = null) {
    return {
      where(field, operator, value) {
        if (operator !== '==') throw new Error(`unsupported operator: ${operator}`);
        return collection(path, [...filters, { field, value }], max);
      },
      limit(value) { return collection(path, filters, value); },
      async get() {
        const prefix = `${path}/`;
        let docs = [...store.entries()]
          .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => value }))
          .filter((entry) => filters.every(({ field, value }) => entry.data()?.[field] === value));
        if (max !== null) docs = docs.slice(0, max);
        return { docs, size: docs.length };
      },
    };
  }

  const db = {
    doc,
    collection,
    async runTransaction(handler) {
      const writes = [];
      const result = await handler({
        get: (ref) => ref.get(),
        set: (ref, value, options) => writes.push(() => {
          const current = store.get(ref.path) || {};
          store.set(ref.path, options?.merge ? { ...current, ...value } : value);
        }),
        create: (ref, value) => writes.push(() => {
          if (store.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
          store.set(ref.path, value);
        }),
      });
      writes.forEach((write) => write());
      return result;
    },
  };
  let outerCompleteFailures = failOuterCompleteOnce ? 1 : 0;
  const idempotencyService = {
    begin: async () => ({ mode: 'new', requestFingerprint: 'fingerprint-1' }),
    async checkInTransaction(tx, { idempotencyKey, requestFingerprint }) {
      const ref = db.doc(`test-idempotency/${encodeURIComponent(idempotencyKey)}`);
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() || {} : {};
      if (current.requestFingerprint && current.requestFingerprint !== requestFingerprint) {
        return { mode: 'conflict', reason: 'different payload', ref };
      }
      if (current.status === 'completed') {
        return { mode: 'replay', status: current.responseStatus, body: current.responseBody, ref };
      }
      return { mode: 'started', requestFingerprint, ref };
    },
    completeInTransaction(tx, { ref, requestFingerprint, responseStatus, responseBody }) {
      tx.set(ref, { status: 'completed', requestFingerprint, responseStatus, responseBody }, { merge: true });
    },
    async complete({ idempotencyKey, requestFingerprint, responseStatus, responseBody }) {
      if (idempotencyKey.includes(':identity:')) {
        await db.doc(`test-idempotency/${encodeURIComponent(idempotencyKey)}`).set({
          status: 'completed', requestFingerprint, responseStatus, responseBody,
        }, { merge: true });
        return;
      }
      if (outerCompleteFailures > 0) {
        outerCompleteFailures -= 1;
        throw new Error('response completion interrupted');
      }
    },
    fail: async () => {},
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a', actorId: 'admin-1', actorRole: 'admin', actorEmail: '',
      requestId: 'request-1', idempotencyKey: 'idempotency-1',
    };
    next();
  });
  mountMemberRoutes(app, {
    db,
    now: () => '2026-08-14T01:02:03.000Z',
    idempotencyService,
    auditChainService: {
      async appendManyInTransaction(_tx, entries) {
        if (failAudit || entries.some((entry) => entry.entityId === failAuditEntityId)) {
          throw new Error('audit unavailable');
        }
        audits.push(...entries);
      },
    },
    piiProtector: { encryptText: async () => ({ ciphertext: 'encrypted' }) },
    rbacPolicy: { roleChangeRules: { admin: ['admin', 'finance', 'pm'] } },
    authAdminService: {
      async listUsers() {
        return {
          users: [
            { uid: 'admin-1', email: 'admin@example.com', customClaims: { role: 'admin', tenantId: 'tenant-a' } },
            { uid: 'target-1', email: 'target@example.com', customClaims: { role: 'pm', tenantId: 'tenant-a' } },
            ...extraAuthUsers,
          ],
        };
      },
      async setCustomUserClaims(uid, claims) {
        claimsCalls.push({ uid, claims });
        if (failClaims) throw new Error('claims unavailable');
      },
    },
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ error: error.code || 'internal_error' });
  });
  return { app, store, audits, claimsCalls };
}

describe('member role authority', () => {
  it('writes the exact People-linked member, audit, and outbox together', async () => {
    const harness = createRoleHarness();
    const response = await request(harness.app)
      .patch('/api/v1/members/target-1/role')
      .send({ role: 'finance', reason: '현금흐름 중간관리자 지정' });

    expect(response.status).toBe(200);
    expect(harness.store.get('orgs/tenant-a/members/target-1')).toMatchObject({ role: 'finance' });
    expect(harness.audits).toEqual([expect.objectContaining({
      action: 'ROLE_CHANGE', entityId: 'target-1', metadata: expect.objectContaining({ reason: '현금흐름 중간관리자 지정' }),
    })]);
    expect([...harness.store.keys()].filter((key) => key.startsWith('outbox/'))).toHaveLength(1);
  });

  it('rolls back the member and outbox when the atomic audit fails', async () => {
    const harness = createRoleHarness({ failAudit: true });
    const response = await request(harness.app)
      .patch('/api/v1/members/target-1/role')
      .send({ role: 'finance', reason: '감사 원자성 확인' });

    expect(response.status).toBe(500);
    expect(harness.store.get('orgs/tenant-a/members/target-1')).toMatchObject({ role: 'pm' });
    expect([...harness.store.keys()].filter((key) => key.startsWith('outbox/'))).toHaveLength(0);
  });

  it('ignores inactive and mismatched admin docs when protecting the last active exact UID admin', async () => {
    const harness = createRoleHarness({
      patch: {
        'orgs/tenant-a/persons/person-admin-1': { personId: 'person-admin-1', uid: 'admin-1' },
        'orgs/tenant-a/members/inactive-admin': { uid: 'inactive-admin', role: 'admin', status: 'INACTIVE' },
        'orgs/tenant-a/members/mismatched-admin': { uid: 'other-uid', role: 'admin', status: 'ACTIVE' },
      },
    });
    const response = await request(harness.app)
      .patch('/api/v1/members/admin-1/role')
      .send({ role: 'pm', reason: '마지막 관리자 보호 확인' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('last_admin_lockout');
    expect(harness.store.get('orgs/tenant-a/members/admin-1')).toMatchObject({ role: 'admin' });
  });

  it('requires a reason before deep sync writes', async () => {
    const harness = createRoleHarness();
    const response = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/target%40example.com/deep-sync')
      .send({ role: 'finance' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('role_change_reason_required');
    expect(harness.store.get('orgs/tenant-a/members/target-1')).toMatchObject({ role: 'pm' });
    expect(harness.audits).toHaveLength(0);
    expect(harness.claimsCalls).toHaveLength(0);
  });

  it('checks the last exact active admin inside deep sync transaction', async () => {
    const harness = createRoleHarness({
      patch: {
        'orgs/tenant-a/members/inactive-admin': { uid: 'inactive-admin', role: 'admin', status: 'INACTIVE' },
        'orgs/tenant-a/members/mismatched-admin': { uid: 'other-admin', role: 'admin', status: 'ACTIVE' },
      },
    });
    const response = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/admin%40example.com/deep-sync')
      .send({ role: 'pm', reason: '관리자 권한 회수' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('last_admin_lockout');
    expect(harness.store.get('orgs/tenant-a/members/admin-1')).toMatchObject({ role: 'admin' });
    expect(harness.audits).toHaveLength(0);
  });

  it('rolls back canonical, legacy, and outbox writes when deep sync audit fails', async () => {
    const harness = createRoleHarness({
      failAudit: true,
      patch: {
        'orgs/tenant-a/members/target_example_com': {
          uid: 'target_example_com', email: 'target@example.com', role: 'pm', status: 'ACTIVE',
        },
      },
    });
    const response = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/target%40example.com/deep-sync')
      .send({ role: 'finance', reason: '감사 원자성 확인' });

    expect(response.status).toBe(500);
    expect(harness.store.get('orgs/tenant-a/members/target-1')).toMatchObject({ role: 'pm' });
    expect(harness.store.get('orgs/tenant-a/members/target_example_com')).toMatchObject({ role: 'pm' });
    expect([...harness.store.keys()].filter((key) => key.startsWith('outbox/'))).toHaveLength(0);
    expect(harness.claimsCalls).toHaveLength(0);
  });

  it('keeps committed audited member authority visible when claims sync fails', async () => {
    const harness = createRoleHarness({ failClaims: true });
    const response = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/target%40example.com/deep-sync')
      .send({ role: 'finance', reason: '권한 정렬' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      role: 'finance', claimsUpdated: false, claimsSyncStatus: 'PENDING',
    });
    expect(harness.store.get('orgs/tenant-a/members/target-1')).toMatchObject({
      role: 'finance',
      authClaimsSync: expect.objectContaining({ status: 'PENDING', role: 'finance' }),
    });
    expect(harness.audits).toEqual([expect.objectContaining({
      action: 'ROLE_CHANGE',
      metadata: expect.objectContaining({ claimsSyncStatus: 'PENDING', reason: '권한 정렬' }),
    })]);
    expect([...harness.store.keys()].filter((key) => key.startsWith('outbox/'))).toHaveLength(1);
    expect(harness.claimsCalls).toHaveLength(1);
  });

  it('continues bulk deep sync after one identity fails and returns ordered outcomes', async () => {
    const harness = createRoleHarness({
      failAuditEntityId: 'target-1',
      patch: {
        'orgs/tenant-a/members/target-2': {
          uid: 'target-2', email: 'target2@example.com', role: 'pm', status: 'ACTIVE',
        },
      },
      extraAuthUsers: [{
        uid: 'target-2', email: 'target2@example.com', customClaims: { role: 'pm', tenantId: 'tenant-a' },
      }],
    });

    const response = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/deep-sync-bulk')
      .send({
        reason: '권한 일괄 정렬',
        items: [
          { identityKey: 'target@example.com', role: 'finance' },
          { identityKey: 'target2@example.com', role: 'finance' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.outcomes).toEqual([
      expect.objectContaining({
        identityKey: 'target@example.com', status: 'FAILED', errorCode: 'internal_error',
      }),
      expect.objectContaining({
        identityKey: 'target2@example.com', status: 'SUCCEEDED',
        result: expect.objectContaining({ role: 'finance', claimsSyncStatus: 'SYNCED' }),
      }),
    ]);
    expect(response.body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, pendingClaimsSync: 0 });
    expect(harness.store.get('orgs/tenant-a/members/target-1')).toMatchObject({ role: 'pm' });
    expect(harness.store.get('orgs/tenant-a/members/target-2')).toMatchObject({ role: 'finance' });
    expect(harness.audits).toEqual([expect.objectContaining({ entityId: 'target-2' })]);
    expect(harness.claimsCalls).toEqual([expect.objectContaining({ uid: 'target-2' })]);
  });

  it('rejects duplicate bulk identities before any authority write', async () => {
    const harness = createRoleHarness();
    const response = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/deep-sync-bulk')
      .send({
        reason: '권한 일괄 정렬',
        items: [
          { identityKey: 'target@example.com', role: 'finance' },
          { identityKey: 'TARGET@example.com', role: 'finance' },
        ],
      });

    expect(response.status).toBe(400);
    expect(harness.store.get('orgs/tenant-a/members/target-1')).toMatchObject({ role: 'pm' });
    expect(harness.audits).toHaveLength(0);
    expect(harness.claimsCalls).toHaveLength(0);
  });

  it('replays committed bulk identities without duplicate audit or outbox after response completion is interrupted', async () => {
    const harness = createRoleHarness({
      failOuterCompleteOnce: true,
      patch: {
        'orgs/tenant-a/members/target-2': {
          uid: 'target-2', email: 'target2@example.com', role: 'pm', status: 'ACTIVE',
        },
      },
      extraAuthUsers: [{
        uid: 'target-2', email: 'target2@example.com', customClaims: { role: 'pm', tenantId: 'tenant-a' },
      }],
    });
    const payload = {
      reason: '권한 일괄 정렬',
      items: [
        { identityKey: 'target@example.com', role: 'finance' },
        { identityKey: 'target2@example.com', role: 'finance' },
      ],
    };

    const interrupted = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/deep-sync-bulk')
      .send(payload);
    expect(interrupted.status).toBe(500);
    expect(harness.audits).toHaveLength(2);
    expect([...harness.store.keys()].filter((key) => key.startsWith('outbox/'))).toHaveLength(2);
    expect(harness.claimsCalls).toHaveLength(2);

    const replayed = await request(harness.app)
      .post('/api/v1/admin/auth-governance/users/deep-sync-bulk')
      .send(payload);
    expect(replayed.status).toBe(200);
    expect(replayed.body.outcomes.map(({ status }) => status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect(harness.audits).toHaveLength(2);
    expect([...harness.store.keys()].filter((key) => key.startsWith('outbox/'))).toHaveLength(2);
    expect(harness.claimsCalls).toHaveLength(2);
  });
});
