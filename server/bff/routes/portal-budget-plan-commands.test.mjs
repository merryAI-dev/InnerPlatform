import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalBudgetPlanCommandRoutes } from './portal-budget-plan-commands.mjs';

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
      requestId: 'req-budget-plan-save',
      idempotencyKey: 'idem-budget-plan-save',
    };
    next();
  });

  mountPortalBudgetPlanCommandRoutes(app, {
    db,
    now: () => '2026-04-17T12:00:00.000Z',
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

describe('portal budget plan command routes', () => {
  it('saves budget plan rows for an existing project', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/projects/p001/budget_summary/default': {
        id: 'default',
        projectId: 'p001',
        rows: [
          { budgetCode: '1. 인건비', subCode: '1.1 참여인력', initialBudget: 1000000, revisedBudget: 1000000 },
        ],
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/budget/plan/save')
      .set('idempotency-key', 'idem-budget-plan-save')
      .send({
        projectId: 'p001',
        rows: [
          { budgetCode: '1. 인건비', subCode: '1.1 급여', initialBudget: 1200000, revisedBudget: 1300000, note: '갱신' },
          { budgetCode: '2. 운영비', subCode: '2.1 소모품', initialBudget: 500000 },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.budgetPlanRows).toEqual([
      { budgetCode: '1. 인건비', subCode: '1.1 급여', initialBudget: 1200000, revisedBudget: 1300000, note: '갱신' },
      { budgetCode: '2. 운영비', subCode: '2.1 소모품', initialBudget: 500000, revisedBudget: 0 },
    ]);
    expect(response.body.summary).toMatchObject({
      projectId: 'p001',
      rowCount: 2,
    });
    expect(db.docs.get('orgs/mysc/projects/p001/budget_summary/default')?.rows).toEqual([
      { budgetCode: '1. 인건비', subCode: '1.1 급여', initialBudget: 1200000, revisedBudget: 1300000, note: '갱신' },
      { budgetCode: '2. 운영비', subCode: '2.1 소모품', initialBudget: 500000, revisedBudget: 0 },
    ]);
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects invalid budget plan drafts', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/budget/plan/save')
      .set('idempotency-key', 'idem-budget-plan-invalid')
      .send({
        projectId: 'p001',
        rows: [
          { budgetCode: '', subCode: '1.1 급여', initialBudget: 1200000 },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_budget_plan');
  });

  it('rejects budget plan saves for missing projects', async () => {
    const db = createFakeDb({});
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/budget/plan/save')
      .set('idempotency-key', 'idem-budget-plan-missing-project')
      .send({
        projectId: 'p404',
        rows: [
          { budgetCode: '1. 인건비', subCode: '1.1 급여', initialBudget: 1200000 },
        ],
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('project_not_found');
  });
});
