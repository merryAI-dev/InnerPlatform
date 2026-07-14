import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { mountCashflowExportRoutes } from './cashflow-exports.mjs';

describe('cashflow export route contract', () => {
  it('does not expose the legacy BFF canonical-write routes', async () => {
    const app = express();
    app.use(express.json());
    mountCashflowExportRoutes(app, { db: {}, rbacPolicy: {} });

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-weeks/upsert')
      .send({})
      .expect(404);
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-actuals/sync')
      .send({})
      .expect(404);
  });
});
