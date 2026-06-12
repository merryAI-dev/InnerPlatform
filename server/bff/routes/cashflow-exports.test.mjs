import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountCashflowExportRoutes } from './cashflow-exports.mjs';

function createApp({ legacyCashflowWritesEnabled } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      actorEmail: 'actor@mysc.co.kr',
      actorRole: 'finance',
      requestId: 'req-1',
      idempotencyKey: 'idem-1',
    };
    next();
  });
  mountCashflowExportRoutes(app, {
    db: {
      doc: vi.fn(),
      collection: vi.fn(),
    },
    rbacPolicy: {},
    idempotencyService: {
      begin: vi.fn(async () => ({
        mode: 'new',
        requestFingerprint: 'fingerprint-1',
      })),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
    },
    now: () => '2026-06-12T00:00:00.000Z',
    legacyCashflowWritesEnabled,
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      code: error.code || 'error',
      message: error.message,
    });
  });
  return app;
}

describe('cashflow export routes', () => {
  it('blocks legacy BFF cashflow week writes by default', async () => {
    const response = await request(createApp())
      .post('/api/v1/projects/project-a/cashflow-weeks/upsert')
      .send({
        mode: 'projection',
        yearMonth: '2026-06',
        weekNo: 1,
        amounts: { SALES_IN: 1000 },
      })
      .expect(410);

    expect(response.body.code).toBe('legacy_bff_cashflow_write_disabled');
  });

  it('blocks legacy BFF cashflow actual sync by default', async () => {
    const response = await request(createApp())
      .post('/api/v1/projects/project-a/cashflow-actuals/sync')
      .send({})
      .expect(410);

    expect(response.body.code).toBe('legacy_bff_cashflow_write_disabled');
  });
});
