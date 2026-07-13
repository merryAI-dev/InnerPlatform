import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createBffApp } from '../app.mjs';
import { mountEditLeaseRoutes } from './edit-leases.mjs';

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
  service = createService(),
  context = {},
  piiProtector = { encryptText: vi.fn(async () => ({ ciphertext: 'encrypted-email' })) },
} = {}) {
  const app = express();
  const outsideAudit = vi.fn(async () => {});
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      actorRole: 'pm',
      actorEmail: 'actor@example.com',
      actorName: 'Actor A',
      requestId: 'request-a',
      idempotencyKey: req.header('idempotency-key') || undefined,
      ...context,
    };
    next();
  });
  mountEditLeaseRoutes(app, {
    enabled,
    editLeaseService: service,
    auditChainService: { append: outsideAudit },
    piiProtector,
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      error: error.code || 'internal_error',
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  });
  return { app, service, outsideAudit, piiProtector };
}

function leaseHeaders(extra = {}) {
  return {
    'x-edit-session-id': 'session-a',
    'idempotency-key': 'idem-route-a',
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

  it('passes encrypted audit and idempotency context into the atomic service', async () => {
    const { app, service, outsideAudit } = createApp();

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
      actorEmailEnc: 'encrypted-email',
      requestId: 'request-a',
      idempotencyKey: 'idem-route-a',
      sessionId: 'session-a',
    });
    expect(outsideAudit).not.toHaveBeenCalled();
  });

  it('preserves a safe conflict response without appending audit outside the service transaction', async () => {
    const service = createService();
    service.acquire.mockRejectedValue(Object.assign(new Error('The edit lease is held by another session'), {
      statusCode: 423,
      code: 'edit_lease_held',
      details: {
        holderDisplayName: 'Actor B',
        sameActor: false,
        expiresAt: '2026-07-10T00:30:00.000Z',
      },
      leaseId: 'must-not-leak',
      sessionId: 'must-not-leak',
    }));
    const { app, outsideAudit } = createApp({ service });

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
    expect(outsideAudit).not.toHaveBeenCalled();
  });

  it('returns the service-owned expiry projection without internal audit fields', async () => {
    const service = createService();
    service.getStatus.mockResolvedValue({
      serverNow: '2026-07-10T00:30:00.000Z',
      state: 'EXPIRED',
      canEdit: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
    });
    const { app, outsideAudit } = createApp({ service });

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
    expect(outsideAudit).not.toHaveBeenCalled();
  });

  it('does not encrypt actor email for an ordinary active status read', async () => {
    const piiProtector = { encryptText: vi.fn(async () => ({ ciphertext: 'must-not-be-used' })) };
    const { app, service } = createApp({ piiProtector });

    await request(app)
      .get('/api/v1/edit-leases/project-info/project-a')
      .set(leaseHeaders())
      .expect(200);

    expect(service.getStatus).toHaveBeenCalledOnce();
    expect(piiProtector.encryptText).not.toHaveBeenCalled();
  });

  it('marks an exact atomic replay without changing its response body', async () => {
    const service = createService();
    const body = {
      serverNow: '2026-07-10T00:05:00.000Z',
      state: 'ACTIVE',
      canEdit: true,
      expiresAt: '2026-07-10T00:35:00.000Z',
      leaseId: 'lease-secret',
      fence: 4,
    };
    service.extend.mockResolvedValue({ status: 200, body, replayed: true });
    const { app } = createApp({ service });

    const response = await request(app)
      .post('/api/v1/edit-leases/project-info/project-a/extend')
      .set(leaseHeaders({ 'x-edit-lease-id': 'lease-secret', 'x-edit-fence': '4' }))
      .send({})
      .expect(200);

    expect(response.headers['x-idempotency-replayed']).toBe('1');
    expect(response.body).toEqual(body);
  });

  it('parses exact lease ownership headers for extend and release', async () => {
    const { app, service } = createApp();
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

    expect(service.extend.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-a', leaseId: 'lease-secret', fence: 4, idempotencyKey: 'idem-route-a',
    });
    expect(service.release.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-a', leaseId: 'lease-secret', fence: 4, idempotencyKey: 'idem-route-a',
    });
  });

  it('rejects invalid ownership headers before the lease service', async () => {
    const { app, service } = createApp();

    await request(app)
      .post('/api/v1/edit-leases/project-info/project-a/extend')
      .set(leaseHeaders({ 'x-edit-lease-id': 'lease-secret', 'x-edit-fence': '4.5' }))
      .send({})
      .expect(400);

    expect(service.extend).not.toHaveBeenCalled();
  });

  it('rejects resource IDs whose derived document ID exceeds the Firestore byte limit', async () => {
    const { app, service } = createApp();
    const oversizedResourceId = encodeURIComponent('한'.repeat(512));

    const response = await request(app)
      .get(`/api/v1/edit-leases/project-info/${oversizedResourceId}`)
      .set(leaseHeaders())
      .expect(400);

    expect(response.body).toMatchObject({ error: 'edit_lease_resource_invalid' });
    expect(service.getStatus).not.toHaveBeenCalled();
  });
});
