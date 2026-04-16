import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalWeeklySubmissionCommandRoutes } from './portal-weekly-submission-commands.mjs';

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

  const db = {
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

  return db;
}

function createApp(db, auditEntries = []) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'mysc',
      actorId: 'u001',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
      requestId: 'req-weekly-submit',
      idempotencyKey: 'idem-weekly-submit',
    };
    next();
  });

  mountPortalWeeklySubmissionCommandRoutes(app, {
    db,
    now: () => '2026-04-16T13:00:00.000Z',
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

describe('portal weekly submission command routes', () => {
  it('submits the cashflow week and all selected transactions through one command', async () => {
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
        pmSubmitted: false,
      },
      'orgs/mysc/transactions/tx-1': {
        id: 'tx-1',
        projectId: 'p001',
        state: 'DRAFT',
        version: 3,
      },
      'orgs/mysc/transactions/tx-2': {
        id: 'tx-2',
        projectId: 'p001',
        state: 'DRAFT',
        version: 5,
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/weekly-submissions/submit')
      .set('idempotency-key', 'idem-weekly-submit')
      .send({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        transactionIds: ['tx-1', 'tx-2'],
      });

    expect(response.status).toBe(200);
    expect(response.body.cashflowWeek).toMatchObject({
      id: 'p001-2026-04-w3',
      projectId: 'p001',
      yearMonth: '2026-04',
      weekNo: 3,
      pmSubmitted: true,
      pmSubmittedByUid: 'u001',
    });
    expect(response.body.transactions).toEqual([
      expect.objectContaining({ id: 'tx-1', state: 'SUBMITTED', submittedBy: 'u001', version: 4 }),
      expect.objectContaining({ id: 'tx-2', state: 'SUBMITTED', submittedBy: 'u001', version: 6 }),
    ]);
    expect(db.docs.get('orgs/mysc/cashflowWeeks/p001-2026-04-w3')?.pmSubmitted).toBe(true);
    expect(db.docs.get('orgs/mysc/transactions/tx-1')?.state).toBe('SUBMITTED');
    expect(db.docs.get('orgs/mysc/transactions/tx-2')?.state).toBe('SUBMITTED');
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects submit commands when a transaction belongs to another project', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/transactions/tx-1': {
        id: 'tx-1',
        projectId: 'p999',
        state: 'DRAFT',
        version: 1,
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/weekly-submissions/submit')
      .set('idempotency-key', 'idem-weekly-submit-project-mismatch')
      .send({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        transactionIds: ['tx-1'],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
    expect(String(response.body.message || '')).toContain('tx-1');
  });
});
