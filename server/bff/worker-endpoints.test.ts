import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createBffApp } from './app.mjs';

function createTestApp() {
  // These tests assert routing + auth gates only (no Firestore calls should happen).
  const stubDb = {
    doc: () => { throw new Error('db not expected'); },
    runTransaction: async () => { throw new Error('db not expected'); },
    collection: () => { throw new Error('db not expected'); },
  } as any;

  return createBffApp({
    projectId: 'demo-mysc',
    db: stubDb,
    authMode: 'headers',
    tokenVerifier: async () => ({}),
    workerSecret: 'test-secret',
  });
}

describe('internal worker endpoints (cron)', () => {
  it('supports GET for outbox worker route', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/internal/workers/outbox/run');
    expect(res.status).toBe(401);
    expect(res.body?.error).toBe('unauthorized_worker');
  });

  it('supports GET for work queue worker route', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/internal/workers/work-queue/run');
    expect(res.status).toBe(401);
    expect(res.body?.error).toBe('unauthorized_worker');
  });

  it('supports GET for payroll worker route', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/internal/workers/payroll/run');
    expect(res.status).toBe(401);
    expect(res.body?.error).toBe('unauthorized_worker');
  });

  it('supports GET for monthly close worker route', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/internal/workers/monthly-close/run');
    expect(res.status).toBe(401);
    expect(res.body?.error).toBe('unauthorized_worker');
  });
});
