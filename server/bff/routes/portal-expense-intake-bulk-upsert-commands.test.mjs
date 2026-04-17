import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalExpenseIntakeBulkUpsertCommandRoutes } from './portal-expense-intake-bulk-upsert-commands.mjs';

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

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'mysc',
      actorId: 'pm-1',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
      requestId: 'req-expense-intake-bulk-upsert',
      idempotencyKey: 'idem-expense-intake-bulk-upsert',
    };
    next();
  });

  mountPortalExpenseIntakeBulkUpsertCommandRoutes(app, {
    db,
    now: () => '2026-04-17T09:30:00.000Z',
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
  });

  app.use((error, _req, res, _next) => {
    res.status(error?.statusCode || 500).json({
      error: error?.code || 'internal_error',
      message: error?.message || 'Request failed',
    });
  });

  return app;
}

describe('portal expense intake bulk upsert command routes', () => {
  it('bulk upserts normalized intake items without mutating any sheet documents', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/projects/p001/expense_sheets/default': {
        id: 'default',
        projectId: 'p001',
        rowCount: 1,
      },
    });
    const app = createApp(db);

    const response = await request(app)
      .post('/api/v1/portal/expense-intake/bulk-upsert')
      .set('idempotency-key', 'idem-expense-intake-bulk-upsert')
      .send({
        projectId: 'p001',
        items: [
          {
            id: 'fp-1',
            sourceTxId: 'bank:fp-1',
            bankFingerprint: 'fp-1',
            bankSnapshot: {
              accountNumber: '111-222-333',
              dateTime: '2026-04-17T08:00:00.000Z',
              counterparty: '가맹점',
              memo: '카드 결제',
              signedAmount: -120000,
              balanceAfter: 910000,
            },
            matchState: 'PENDING_INPUT',
            manualFields: {
              budgetCategory: '여비',
              budgetSubCategory: '교통비',
              memo: '기존 메모',
            },
            lastUploadBatchId: 'batch-1',
            createdAt: '2026-04-17T08:10:00.000Z',
            updatedAt: '2026-04-17T08:15:00.000Z',
            updatedBy: 'pm-old',
          },
          {
            id: 'fp-2',
            sourceTxId: 'bank:fp-2',
            bankFingerprint: 'fp-2',
            bankSnapshot: {
              accountNumber: '111-222-333',
              dateTime: '2026-04-17T08:30:00.000Z',
              counterparty: '협력사',
              memo: '세금계산서',
              signedAmount: -450000,
              balanceAfter: 460000,
            },
            matchState: 'AUTO_CONFIRMED',
            manualFields: {
              expenseAmount: 450000,
              budgetCategory: '외주비',
              budgetSubCategory: '용역비',
              cashflowCategory: 'OUTSOURCING',
              evidenceCompletedDesc: '세금계산서',
            },
            lastUploadBatchId: 'batch-1',
            createdAt: '2026-04-17T08:20:00.000Z',
            updatedAt: '2026-04-17T08:25:00.000Z',
            updatedBy: 'pm-old',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('expenseIntakeItems');
    expect(response.body.summary).toMatchObject({
      projectId: 'p001',
      upsertedCount: 2,
    });
    expect(db.docs.get('orgs/mysc/projects/p001/expense_intake/fp-1')).toMatchObject({
      tenantId: 'mysc',
      id: 'fp-1',
      projectId: 'p001',
      matchState: 'PENDING_INPUT',
      projectionStatus: 'NOT_PROJECTED',
      evidenceStatus: 'MISSING',
      reviewReasons: [],
    });
    expect(db.docs.get('orgs/mysc/projects/p001/expense_sheets/default')).toMatchObject({
      id: 'default',
      projectId: 'p001',
      rowCount: 1,
    });
  });

  it('rejects projection and evidence state fields in the bulk-upsert command payload', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db);

    const response = await request(app)
      .post('/api/v1/portal/expense-intake/bulk-upsert')
      .set('idempotency-key', 'idem-expense-intake-bulk-upsert-invalid')
      .send({
        projectId: 'p001',
        items: [
          {
            id: 'fp-3',
            sourceTxId: 'bank:fp-3',
            bankFingerprint: 'fp-3',
            bankSnapshot: {
              accountNumber: '111-222-333',
              dateTime: '2026-04-17T09:00:00.000Z',
              counterparty: '협력사',
              memo: '지출',
              signedAmount: -150000,
              balanceAfter: 310000,
            },
            matchState: 'PENDING_INPUT',
            projectionStatus: 'PROJECTED',
            evidenceStatus: 'COMPLETE',
            reviewReasons: ['manual_review_required'],
            manualFields: {},
            lastUploadBatchId: 'batch-2',
            createdAt: '2026-04-17T09:00:00.000Z',
            updatedAt: '2026-04-17T09:00:00.000Z',
            updatedBy: 'pm-old',
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(String(response.body.message || '')).toContain('Unrecognized keys');
  });
});
