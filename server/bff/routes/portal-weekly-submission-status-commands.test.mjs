import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalWeeklySubmissionStatusCommandRoutes } from './portal-weekly-submission-status-commands.mjs';

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
      requestId: 'req-weekly-submission-status-upsert',
      idempotencyKey: 'idem-weekly-submission-status-upsert',
    };
    next();
  });

  mountPortalWeeklySubmissionStatusCommandRoutes(app, {
    db,
    now: () => '2026-04-17T10:30:00.000Z',
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

describe('portal weekly submission status command routes', () => {
  it('upserts only the weekly status patch fields through one command', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/weeklySubmissionStatus/p001-2026-04-w3': {
        id: 'p001-2026-04-w3',
        tenantId: 'mysc',
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        projectionEdited: false,
        expenseEdited: false,
        updatedAt: '2026-04-16T09:00:00.000Z',
        updatedByName: 'old-pm',
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/weekly-submission-status/upsert')
      .set('idempotency-key', 'idem-weekly-submission-status-upsert')
      .send({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        projectionEdited: true,
        expenseUpdated: true,
        expenseSyncState: 'review_required',
        expenseReviewPendingCount: 2,
      });

    expect(response.status).toBe(200);
    expect(response.body.weeklySubmissionStatus).toMatchObject({
      id: 'p001-2026-04-w3',
      tenantId: 'mysc',
      projectId: 'p001',
      yearMonth: '2026-04',
      weekNo: 3,
      projectionEdited: true,
      projectionEditedAt: '2026-04-17T10:30:00.000Z',
      projectionEditedByName: 'pm-1',
      expenseUpdated: true,
      expenseUpdatedAt: '2026-04-17T10:30:00.000Z',
      expenseUpdatedByName: 'pm-1',
      expenseSyncState: 'review_required',
      expenseSyncUpdatedAt: '2026-04-17T10:30:00.000Z',
      expenseSyncUpdatedByName: 'pm-1',
      expenseReviewPendingCount: 2,
      updatedAt: '2026-04-17T10:30:00.000Z',
      updatedByName: 'pm-1',
    });
    expect(response.body.summary).toMatchObject({
      id: 'p001-2026-04-w3',
      projectId: 'p001',
      yearMonth: '2026-04',
      weekNo: 3,
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('creates a missing weekly status doc when the project exists', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/weekly-submission-status/upsert')
      .set('idempotency-key', 'idem-weekly-submission-status-create')
      .send({
        projectId: 'p001',
        yearMonth: '2026-05',
        weekNo: 2,
        expenseEdited: true,
        expenseSyncState: 'pending',
      });

    expect(response.status).toBe(200);
    expect(response.body.weeklySubmissionStatus).toMatchObject({
      id: 'p001-2026-05-w2',
      projectId: 'p001',
      yearMonth: '2026-05',
      weekNo: 2,
      expenseEdited: true,
      expenseEditedAt: '2026-04-17T10:30:00.000Z',
      expenseEditedByName: 'pm-1',
      expenseSyncState: 'pending',
    });
    expect(db.docs.get('orgs/mysc/weeklySubmissionStatus/p001-2026-05-w2')?.expenseEdited).toBe(true);
  });

  it('rejects upsert when the project does not exist', async () => {
    const db = createFakeDb({});
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/weekly-submission-status/upsert')
      .set('idempotency-key', 'idem-weekly-submission-status-missing-project')
      .send({
        projectId: 'p404',
        yearMonth: '2026-04',
        weekNo: 1,
        projectionUpdated: true,
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('project_not_found');
  });
});
