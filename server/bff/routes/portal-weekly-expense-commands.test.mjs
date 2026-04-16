import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalWeeklyExpenseCommandRoutes } from './portal-weekly-expense-commands.mjs';

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
      return {
        path,
        async get() {
          return createDocSnapshot(path, docs.get(path));
        },
      };
    },
    async runTransaction(work) {
      const pendingSets = [];
      const pendingCreates = [];
      const tx = {
        async get(ref) {
          return createDocSnapshot(ref.path, docs.get(ref.path));
        },
        set(ref, value, options = { merge: false }) {
          pendingSets.push({ path: ref.path, value, options });
        },
        create(ref, value) {
          pendingCreates.push({ path: ref.path, value });
        },
      };
      const result = await work(tx);
      for (const entry of pendingCreates) {
        if (docs.has(entry.path)) throw new Error(`already exists: ${entry.path}`);
        docs.set(entry.path, entry.value);
      }
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
      requestId: 'req-weekly-expense-save',
      idempotencyKey: 'idem-weekly-expense-save',
    };
    next();
  });

  mountPortalWeeklyExpenseCommandRoutes(app, {
    db,
    now: () => '2026-04-16T12:00:00.000Z',
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

describe('portal weekly expense command routes', () => {
  it('persists the sheet, weekly statuses, and cashflow actuals in one command response', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/projects/p001/expense_sheets/default': {
        id: 'default',
        projectId: 'p001',
        name: '기본 탭',
        version: 2,
        rows: [],
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/weekly-expenses/save')
      .set('idempotency-key', 'idem-weekly-expense-save')
      .send({
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        expectedVersion: 2,
        rows: [
          {
            tempId: 'row-1',
            cells: ['담당자', '1', '2026-04-14', '04-4-3'],
            userEditedCells: [0, 1],
          },
          {
            tempId: 'row-2',
            cells: ['담당자', '2', '2026-04-21', '04-4-4'],
            reviewHints: ['증빙 확인 필요'],
            reviewRequiredCellIndexes: [15],
            reviewStatus: 'pending',
          },
        ],
        syncPlan: [
          {
            yearMonth: '2026-04',
            weekNo: 3,
            amounts: { DIRECT_COST_OUT: 120000 },
            reviewPendingCount: 0,
          },
          {
            yearMonth: '2026-04',
            weekNo: 4,
            amounts: { DIRECT_COST_OUT: 50000 },
            reviewPendingCount: 1,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.sheet).toMatchObject({
      id: 'default',
      projectId: 'p001',
      version: 3,
      rowCount: 2,
    });
    expect(response.body.syncSummary).toEqual({
      expenseSyncState: 'review_required',
      expenseReviewPendingCount: 1,
      syncedWeekCount: 1,
      reviewRequiredWeekCount: 1,
    });
    expect(response.body.weeklySubmissionStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        expenseUpdated: true,
        expenseSyncState: 'synced',
        expenseReviewPendingCount: 0,
      }),
      expect.objectContaining({
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 4,
        expenseUpdated: true,
        expenseSyncState: 'review_required',
        expenseReviewPendingCount: 1,
      }),
    ]));
    expect(response.body.cashflowWeeks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'p001-2026-04-w3',
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 3,
        actual: { DIRECT_COST_OUT: 120000 },
      }),
      expect.objectContaining({
        id: 'p001-2026-04-w4',
        projectId: 'p001',
        yearMonth: '2026-04',
        weekNo: 4,
        actual: { DIRECT_COST_OUT: 50000 },
      }),
    ]));
    expect(db.docs.get('orgs/mysc/projects/p001/expense_sheets/default')?.version).toBe(3);
    expect(db.docs.get('orgs/mysc/weeklySubmissionStatus/p001-2026-04-w4')?.expenseSyncState).toBe('review_required');
    expect(db.docs.get('orgs/mysc/cashflowWeeks/p001-2026-04-w3')?.actual).toEqual({ DIRECT_COST_OUT: 120000 });
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects stale expense sheet versions with a 409 conflict', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/projects/p001/expense_sheets/default': {
        id: 'default',
        projectId: 'p001',
        name: '기본 탭',
        version: 4,
        rows: [],
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/weekly-expenses/save')
      .set('idempotency-key', 'idem-weekly-expense-conflict')
      .send({
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        expectedVersion: 3,
        rows: [
          {
            tempId: 'row-1',
            cells: ['담당자', '1', '2026-04-14', '04-4-3'],
          },
        ],
        syncPlan: [
          {
            yearMonth: '2026-04',
            weekNo: 3,
            amounts: { DIRECT_COST_OUT: 120000 },
            reviewPendingCount: 0,
          },
        ],
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('version_conflict');
  });
});
