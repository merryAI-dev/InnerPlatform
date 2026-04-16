import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountCashflowWeekVarianceCommandRoutes } from './cashflow-week-variance-commands.mjs';

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
      actorId: 'admin-1',
      actorRole: 'admin',
      actorEmail: 'admin@example.com',
      requestId: 'req-variance-week',
      idempotencyKey: 'idem-variance-week',
    };
    next();
  });

  mountCashflowWeekVarianceCommandRoutes(app, {
    db,
    now: () => '2026-04-16T19:00:00.000Z',
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

describe('cashflow week variance command routes', () => {
  it('updates variance flag and history through one server-owned command', async () => {
    const db = createFakeDb({
      'orgs/mysc/cashflowWeeks/p001-2026-04-w3': {
        id: 'p001-2026-04-w3',
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        varianceFlag: null,
        varianceHistory: [],
        version: 4,
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/cashflow/weeks/variance-flag')
      .set('idempotency-key', 'idem-variance-week')
      .send({
        sheetId: 'p001-2026-04-w3',
        varianceFlag: {
          status: 'OPEN',
          reason: '증빙 불일치',
          flaggedBy: '관리자',
          flaggedByUid: 'admin-1',
          flaggedAt: '2026-04-16T18:59:00.000Z',
        },
        varianceHistory: [
          {
            id: 'vf-1',
            action: 'FLAG',
            actor: '관리자',
            actorUid: 'admin-1',
            content: '증빙 불일치',
            timestamp: '2026-04-16T18:59:00.000Z',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.cashflowWeek).toMatchObject({
      id: 'p001-2026-04-w3',
      varianceFlag: {
        status: 'OPEN',
        reason: '증빙 불일치',
      },
      varianceHistory: [
        expect.objectContaining({
          id: 'vf-1',
          action: 'FLAG',
        }),
      ],
      version: 5,
    });
    expect(response.body.summary).toEqual({
      hasVarianceFlag: true,
      varianceHistoryCount: 1,
    });
    expect(auditEntries).toHaveLength(1);
  });
});
