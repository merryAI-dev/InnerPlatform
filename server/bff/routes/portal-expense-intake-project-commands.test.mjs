import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalExpenseIntakeProjectCommandRoutes } from './portal-expense-intake-project-commands.mjs';

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
      requestId: 'req-expense-intake-project',
      idempotencyKey: 'idem-expense-intake-project',
    };
    next();
  });

  mountPortalExpenseIntakeProjectCommandRoutes(app, {
    db,
    now: () => '2026-04-16T20:00:00.000Z',
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

describe('portal expense intake project command routes', () => {
  it('projects one manual-complete intake item into the expense sheet through one command', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/projects/p001/expense_intake/fp-1': {
        id: 'fp-1',
        projectId: 'p001',
        sourceTxId: 'bank:fp-1',
        bankFingerprint: 'fp-1',
        bankSnapshot: {
          accountNumber: '111-222-333',
          dateTime: '2026-04-16T09:30:00+09:00',
          counterparty: '가맹점',
          memo: '카드 결제',
          signedAmount: -120000,
          balanceAfter: 910000,
        },
        matchState: 'PENDING_INPUT',
        projectionStatus: 'NOT_PROJECTED',
        evidenceStatus: 'MISSING',
        manualFields: {
          expenseAmount: 120000,
          budgetCategory: '여비',
          budgetSubCategory: '교통비',
          cashflowLineId: 'DIRECT_COST_OUT',
          memo: '기존 메모',
        },
        reviewReasons: ['manual_review_required'],
        lastUploadBatchId: 'batch-1',
        createdAt: '2026-04-16T18:00:00.000Z',
        updatedAt: '2026-04-16T18:00:00.000Z',
        updatedBy: 'pm-old',
        version: 2,
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/expense-intake/project')
      .set('idempotency-key', 'idem-expense-intake-project')
      .send({
        projectId: 'p001',
        intakeId: 'fp-1',
        updates: {
          manualFields: {
            memo: '수정 메모',
            evidenceCompletedDesc: '출장신청서',
          },
          reviewReasons: ['manual_review_required', 'evidence_missing'],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.expenseIntakeItem).toMatchObject({
      id: 'fp-1',
      projectId: 'p001',
      sourceTxId: 'bank:fp-1',
      manualFields: {
        expenseAmount: 120000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowLineId: 'DIRECT_COST_OUT',
        memo: '수정 메모',
        evidenceCompletedDesc: '출장신청서',
      },
      reviewReasons: ['manual_review_required', 'evidence_missing'],
      matchState: 'AUTO_CONFIRMED',
      projectionStatus: 'PROJECTED_WITH_PENDING_EVIDENCE',
      evidenceStatus: 'PARTIAL',
      existingExpenseSheetId: 'default',
      existingExpenseRowTempId: 'bank-fp-1',
      updatedBy: 'pm-1',
      version: 3,
    });
    expect(response.body.expenseSheet).toMatchObject({
      id: 'default',
      projectId: 'p001',
      rowCount: 1,
      version: 1,
    });
    expect(response.body.projectedRow).toMatchObject({
      tempId: 'bank-fp-1',
      sourceTxId: 'bank:fp-1',
    });
    expect(response.body.summary).toMatchObject({
      projectId: 'p001',
      intakeId: 'fp-1',
      targetSheetId: 'default',
      projectedRowTempId: 'bank-fp-1',
      version: 3,
    });
    expect(db.docs.get('orgs/mysc/projects/p001/expense_sheets/default')?.rowCount).toBe(1);
    expect(db.docs.get('orgs/mysc/projects/p001/expense_sheets/default')?.rows?.[0]?.sourceTxId).toBe('bank:fp-1');
    expect(db.docs.get('orgs/mysc/projects/p001/expense_intake/fp-1')?.existingExpenseRowTempId).toBe('bank-fp-1');
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects projection when the merged manual fields are still incomplete', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/projects/p001/expense_intake/fp-2': {
        id: 'fp-2',
        projectId: 'p001',
        sourceTxId: 'bank:fp-2',
        bankFingerprint: 'fp-2',
        bankSnapshot: {
          accountNumber: '111-222-333',
          dateTime: '2026-04-16T09:30:00+09:00',
          counterparty: '가맹점',
          memo: '카드 결제',
          signedAmount: -120000,
          balanceAfter: 910000,
        },
        matchState: 'PENDING_INPUT',
        projectionStatus: 'NOT_PROJECTED',
        evidenceStatus: 'MISSING',
        manualFields: {
          budgetCategory: '여비',
        },
        reviewReasons: [],
        lastUploadBatchId: 'batch-1',
        createdAt: '2026-04-16T18:00:00.000Z',
        updatedAt: '2026-04-16T18:00:00.000Z',
        updatedBy: 'pm-old',
        version: 1,
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/expense-intake/project')
      .set('idempotency-key', 'idem-expense-intake-project-incomplete')
      .send({
        projectId: 'p001',
        intakeId: 'fp-2',
        updates: {
          manualFields: {
            memo: '메모만 추가',
          },
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('manual_fields_incomplete');
  });
});
