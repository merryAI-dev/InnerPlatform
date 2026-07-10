import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createBffApp } from '../app.mjs';
import { loadRbacPolicy } from '../rbac-policy.mjs';
import { sha256 } from '../utils.mjs';
import { mountEditLeaseRoutes } from './edit-leases.mjs';

function createDb(seed = {}) {
  const documents = new Map(Object.entries(seed));
  return {
    doc: (path) => ({
      path,
      get: async () => ({
        exists: documents.has(path),
        data: () => documents.get(path),
      }),
    }),
  };
}

function createService() {
  return {
    getStatus: vi.fn(async () => ({
      serverNow: '2026-07-10T00:00:00.000Z',
      state: 'ACTIVE',
      canEdit: true,
      expiresAt: '2026-07-10T00:30:00.000Z',
      leaseId: 'lease-secret',
      fence: 4,
    })),
    acquire: vi.fn(async () => ({
      serverNow: '2026-07-10T00:00:00.000Z',
      state: 'ACTIVE',
      canEdit: true,
      expiresAt: '2026-07-10T00:30:00.000Z',
      leaseId: 'lease-secret',
      fence: 4,
    })),
    extend: vi.fn(async () => ({
      serverNow: '2026-07-10T00:05:00.000Z',
      state: 'ACTIVE',
      canEdit: true,
      expiresAt: '2026-07-10T00:35:00.000Z',
      leaseId: 'lease-secret',
      fence: 4,
    })),
    release: vi.fn(async () => ({
      serverNow: '2026-07-10T00:05:00.000Z',
      state: 'RELEASED',
      canEdit: false,
      expiresAt: '2026-07-10T00:35:00.000Z',
    })),
  };
}

function createApp({
  enabled = true,
  db = createDb(),
  service = createService(),
  context = {},
  auditChainService = { append: vi.fn(async () => {}) },
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      actorRole: 'pm',
      actorEmail: 'actor@example.com',
      actorName: 'Actor A',
      requestId: 'request-a',
      ...context,
    };
    next();
  });
  mountEditLeaseRoutes(app, {
    enabled,
    db,
    editLeaseService: service,
    rbacPolicy: loadRbacPolicy(),
    auditChainService,
    piiProtector: { encryptText: vi.fn(async () => ({ ciphertext: 'encrypted-email' })) },
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      error: error.code || 'internal_error',
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  });
  return { app, service, auditChainService };
}

function leaseHeaders(extra = {}) {
  return {
    'x-edit-session-id': 'session-a',
    ...extra,
  };
}

describe('edit lease routes', () => {
  it('fails closed before Firestore initialization when enabled in Live', () => {
    const createDb = vi.fn(() => {
      throw new Error('Firestore must not initialize');
    });

    expect(() => createBffApp({
      projectId: 'inner-platform-live-20260316',
      allowedOrigins: ['https://myscube.myscguard.app'],
      createDb,
      editLeasesEnabled: true,
      env: {
        BFF_DEPLOY_ENV: 'live',
        BFF_SCHEDULER_OWNER: 'disabled',
      },
    })).toThrow(/edit leases.*live/i);
    expect(createDb).not.toHaveBeenCalled();
  });

  it('requires the environment flag to run only in Stage', () => {
    const createDb = vi.fn(() => {
      throw new Error('Firestore must not initialize');
    });

    expect(() => createBffApp({
      projectId: 'demo-edit-leases',
      createDb,
      env: {
        BFF_DEPLOY_ENV: 'local',
        BFF_EDIT_LEASES_ENABLED: 'true',
      },
    })).toThrow(/edit leases.*stage/i);
    expect(createDb).not.toHaveBeenCalled();
  });

  it('does not expose the route surface when disabled', async () => {
    const { app } = createApp({ enabled: false });

    await request(app)
      .get('/api/v1/edit-leases/project-info/project-a')
      .set(leaseHeaders())
      .expect(404);
  });

  it('requires an existing owner draft before acquiring a registration lease', async () => {
    const db = createDb({
      'orgs/tenant-a/projectRequestDrafts/draft-a': { ownerUid: 'actor-a' },
    });
    const { app, service, auditChainService } = createApp({ db });

    const response = await request(app)
      .post('/api/v1/edit-leases/project-registration/draft-a/acquire')
      .set(leaseHeaders())
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({ leaseId: 'lease-secret', fence: 4 });
    expect(service.acquire).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      resourceType: 'project-registration',
      resourceId: 'draft-a',
      actorId: 'actor-a',
      actorDisplayName: 'Actor A',
      sessionId: 'session-a',
    });
    expect(auditChainService.append).toHaveBeenCalledOnce();
    expect(auditChainService.append.mock.calls[0][0]).toMatchObject({
      action: 'EDIT_LEASE_ACQUIRE',
      metadata: {
        resourceType: 'project-registration',
        resourceId: 'draft-a',
        sessionIdHash: sha256('tenant-a:session-a'),
        fence: 4,
        resultCode: 'edit_lease_acquired',
      },
    });
    expect(JSON.stringify(auditChainService.append.mock.calls[0][0])).not.toMatch(/lease-secret|session-a|draft.*payload/i);
  });

  it('audits conflicts while the HTTP details expose only the safe holder projection', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
    });
    const service = createService();
    const conflict = Object.assign(new Error('The edit lease is held by another session'), {
      statusCode: 423,
      code: 'edit_lease_held',
      details: {
        holderDisplayName: 'Actor B',
        sameActor: false,
        expiresAt: '2026-07-10T00:30:00.000Z',
      },
      auditContext: {
        serverNow: '2026-07-10T00:00:00.000Z',
        fence: 7,
      },
      leaseId: 'must-not-leak',
      sessionId: 'must-not-leak',
    });
    service.acquire.mockRejectedValue(conflict);
    const { app, auditChainService } = createApp({
      db,
      service,
      context: { actorRole: 'admin' },
    });

    const response = await request(app)
      .post('/api/v1/edit-leases/project-info/project-a/acquire')
      .set(leaseHeaders())
      .send({})
      .expect(423);

    expect(response.body.details).toEqual({
      holderDisplayName: 'Actor B',
      sameActor: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/must-not-leak|leaseId|sessionId|fence|actor-a|@/i);
    expect(auditChainService.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EDIT_LEASE_CONFLICT',
      metadata: expect.objectContaining({
        resourceId: 'project-a',
        sessionIdHash: sha256('tenant-a:session-a'),
        fence: 7,
        resultCode: 'edit_lease_held',
      }),
    }));
  });

  it('strips internal audit context from expired status and records the expiry', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
    });
    const service = createService();
    service.getStatus.mockResolvedValue({
      serverNow: '2026-07-10T00:30:00.000Z',
      state: 'EXPIRED',
      canEdit: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
      audit: { fence: 9 },
    });
    const { app, auditChainService } = createApp({
      db,
      service,
      context: { actorRole: 'admin' },
    });

    const response = await request(app)
      .get('/api/v1/edit-leases/project-info/project-a')
      .set(leaseHeaders())
      .expect(200);

    expect(response.body).toEqual({
      serverNow: '2026-07-10T00:30:00.000Z',
      state: 'EXPIRED',
      canEdit: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
    });
    expect(auditChainService.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EDIT_LEASE_EXPIRE',
      metadata: expect.objectContaining({
        resourceId: 'project-a',
        sessionIdHash: sha256('tenant-a:session-a'),
        fence: 9,
        resultCode: 'edit_lease_expired',
      }),
    }));
  });

  it('returns draft privacy 404 before calling the lease service for another owner', async () => {
    const db = createDb({
      'orgs/tenant-a/projectRequestDrafts/draft-a': { ownerUid: 'actor-b' },
    });
    const { app, service } = createApp({ db });

    await request(app)
      .post('/api/v1/edit-leases/project-registration/draft-a/acquire')
      .set(leaseHeaders())
      .send({})
      .expect(404);

    expect(service.acquire).not.toHaveBeenCalled();
  });

  it('accepts the existing ownerId field while legacy drafts await adoption', async () => {
    const db = createDb({
      'orgs/tenant-a/projectRequestDrafts/draft-a': { ownerId: 'actor-a' },
    });
    const { app, service } = createApp({ db });

    await request(app)
      .post('/api/v1/edit-leases/project-registration/draft-a/acquire')
      .set(leaseHeaders())
      .send({})
      .expect(200);

    expect(service.acquire).toHaveBeenCalledOnce();
  });

  it('allows a PM assigned through the member portal profile to access an existing project', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
      'orgs/tenant-a/members/actor-a': { portalProfile: { projectIds: ['project-a'] } },
    });
    const { app, service } = createApp({ db });

    await request(app)
      .get('/api/v1/edit-leases/cashflow/project-a')
      .set(leaseHeaders())
      .expect(200);

    expect(service.getStatus).toHaveBeenCalledOnce();
  });

  it('denies an unassigned PM before calling the lease service', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
      'orgs/tenant-a/members/actor-a': { projectIds: ['project-b'] },
    });
    const { app, service } = createApp({ db });

    await request(app)
      .get('/api/v1/edit-leases/project-info/project-a')
      .set(leaseHeaders())
      .expect(403);

    expect(service.getStatus).not.toHaveBeenCalled();
  });

  it('denies an explicitly inactive assigned member', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
      'orgs/tenant-a/members/actor-a': { status: 'INACTIVE', projectIds: ['project-a'] },
    });
    const { app, service } = createApp({ db });

    await request(app)
      .get('/api/v1/edit-leases/project-info/project-a')
      .set(leaseHeaders())
      .expect(403);

    expect(service.getStatus).not.toHaveBeenCalled();
  });

  it('allows finance cross-project access but still requires the project to exist', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
    });
    const { app, service } = createApp({ db, context: { actorRole: 'finance' } });

    await request(app)
      .get('/api/v1/edit-leases/project-info/project-a')
      .set(leaseHeaders())
      .expect(200);
    await request(app)
      .get('/api/v1/edit-leases/project-info/missing')
      .set(leaseHeaders())
      .expect(404);

    expect(service.getStatus).toHaveBeenCalledOnce();
  });

  it('parses exact lease headers for extend and release', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
    });
    const { app, service, auditChainService } = createApp({ db, context: { actorRole: 'admin' } });
    const headers = leaseHeaders({
      'x-edit-lease-id': 'lease-secret',
      'x-edit-fence': '4',
    });

    await request(app)
      .post('/api/v1/edit-leases/project-info/project-a/extend')
      .set(headers)
      .send({})
      .expect(200);
    await request(app)
      .post('/api/v1/edit-leases/project-info/project-a/release')
      .set(headers)
      .send({})
      .expect(200);

    expect(service.extend.mock.calls[0][0]).toMatchObject({ leaseId: 'lease-secret', fence: 4 });
    expect(service.release.mock.calls[0][0]).toMatchObject({ leaseId: 'lease-secret', fence: 4 });
    expect(auditChainService.append.mock.calls.map(([entry]) => ({
      action: entry.action,
      metadata: entry.metadata,
    }))).toEqual([
      {
        action: 'EDIT_LEASE_EXTEND',
        metadata: {
          source: 'bff',
          resourceType: 'project-info',
          resourceId: 'project-a',
          sessionIdHash: sha256('tenant-a:session-a'),
          fence: 4,
          state: 'ACTIVE',
          resultCode: 'edit_lease_extended',
        },
      },
      {
        action: 'EDIT_LEASE_RELEASE',
        metadata: {
          source: 'bff',
          resourceType: 'project-info',
          resourceId: 'project-a',
          sessionIdHash: sha256('tenant-a:session-a'),
          fence: 4,
          state: 'RELEASED',
          resultCode: 'edit_lease_released',
        },
      },
    ]);
  });

  it('rejects missing or invalid edit headers before the lease service', async () => {
    const db = createDb({
      'orgs/tenant-a/projects/project-a': { id: 'project-a' },
    });
    const { app, service } = createApp({ db, context: { actorRole: 'admin' } });

    await request(app)
      .post('/api/v1/edit-leases/project-info/project-a/extend')
      .set(leaseHeaders({ 'x-edit-lease-id': 'lease-secret', 'x-edit-fence': '4.5' }))
      .send({})
      .expect(400);

    expect(service.extend).not.toHaveBeenCalled();
  });
});
