import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountCashflowWeekUpsertCommandRoutes } from './cashflow-week-upsert-commands.mjs';

function createDocSnapshot(path, value) {
  const id = String(path).split('/').pop();
  return {
    id,
    exists: value !== undefined,
    data() {
      return value;
    },
  };
}

function createFakeDb(seedDocs = {}) {
  const docs = new Map(Object.entries(seedDocs));

  return {
    docs,
    doc(path) {
      return { path };
    },
    async runTransaction(work) {
      const pendingSets = [];
      const tx = {
        async get(ref) {
          return createDocSnapshot(ref.path, docs.get(ref.path));
        },
        set(ref, value, options = { merge: false }) {
          pendingSets.push({ path: ref.path, value, options });
        },
      };
      const result = await work(tx);
      for (const entry of pendingSets) {
        const current = docs.get(entry.path);
        if (entry.options?.merge && current && typeof current === 'object') {
          docs.set(entry.path, { ...current, ...entry.value });
        } else {
          docs.set(entry.path, entry.value);
        }
      }
      return result;
    },
  };
}

function createApp(db, auditEntries = []) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'mysc',
      actorId: 'pm-1',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
      requestId: 'req-upsert-week',
      idempotencyKey: 'idem-upsert-week',
    };
    next();
  });

  mountCashflowWeekUpsertCommandRoutes(app, {
    db,
    now: () => '2026-04-16T18:40:00.000Z',
    idempotencyService: {},
    createMutatingRoute: (_idempotencyService, handler) => async (req, res, next) => {
      try {
        const result = await handler(req, res);
        if (!result || res.headersSent) return;
        res.status(result.status || 200).json(result.body);
      } catch (error) {
        next(error);
      }
    },
    auditChainService: {
      async append(entry) {
        auditEntries.push(entry);
      },
    },
  });

  app.use((error, _req, res, _next) => {
    res.status(error?.statusCode || 500).json({
      error: error?.code || 'internal_error',
      message: error?.message || 'Request failed',
    });
  });

  return app;
}

describe('cashflow week upsert command routes', () => {
  it('updates projection amounts for an existing cashflow week through one server-owned command', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/cashflowWeeks/p001-2026-04-w3': {
        id: 'p001-2026-04-w3',
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        weekStart: '2026-04-15',
        weekEnd: '2026-04-21',
        projection: { SALES_IN: 100000 },
        actual: {},
        pmSubmitted: false,
        adminClosed: false,
        version: 4,
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/cashflow/weeks/upsert')
      .set('idempotency-key', 'idem-upsert-week')
      .send({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        mode: 'projection',
        amounts: {
          SALES_IN: 250000,
          DIRECT_COST_OUT: 80000,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.cashflowWeek).toMatchObject({
      id: 'p001-2026-04-w3',
      projectId: 'p001',
      yearMonth: '2026-04',
      weekNo: 3,
      projection: {
        SALES_IN: 250000,
        DIRECT_COST_OUT: 80000,
      },
      version: 5,
    });
    expect(response.body.summary).toMatchObject({
      mode: 'projection',
      updatedLineCount: 2,
    });
    expect(db.docs.get('orgs/mysc/cashflowWeeks/p001-2026-04-w3')?.projection?.SALES_IN).toBe(250000);
    expect(auditEntries).toHaveLength(1);
  });

  it('creates the cashflow week when it does not exist yet', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/cashflow/weeks/upsert')
      .set('idempotency-key', 'idem-upsert-week-create')
      .send({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        mode: 'actual',
        amounts: {
          DIRECT_COST_OUT: 91000,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.cashflowWeek).toMatchObject({
      id: 'p001-2026-04-w3',
      projectId: 'p001',
      yearMonth: '2026-04',
      weekNo: 3,
      actual: {
        DIRECT_COST_OUT: 91000,
      },
      pmSubmitted: false,
      adminClosed: false,
    });
  });
});
