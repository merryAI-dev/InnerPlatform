import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalBudgetCodeBookCommandRoutes } from './portal-budget-code-book-commands.mjs';

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
      requestId: 'req-budget-code-book-save',
      idempotencyKey: 'idem-budget-code-book-save',
    };
    next();
  });

  mountPortalBudgetCodeBookCommandRoutes(app, {
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

describe('portal budget code book command routes', () => {
  it('saves the code book and propagates renames into related project documents', async () => {
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
          { budgetCode: '2. 운영비', subCode: '2.1 소모품', initialBudget: 500000, revisedBudget: 500000 },
        ],
      },
      'orgs/mysc/projects/p001/expense_sheets/default': {
        id: 'default',
        projectId: 'p001',
        rows: [
          {
            tempId: 'row-1',
            sourceTxId: 'tx-1',
            cells: [
              '담당자', '1', '2026-04-17', '2026-W16', '법인카드',
              '1. 인건비', '1.1 참여인력', '세세목', '현금흐름',
              '', '', '', '', '', '',
              '지급처', '메모',
            ],
          },
        ],
      },
      'orgs/mysc/budgetEvidenceMaps/p001': {
        projectId: 'p001',
        map: {
          '인건비|참여인력': '계약서',
          '운영비|소모품': '영수증',
        },
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/budget/code-book/save')
      .set('idempotency-key', 'idem-budget-code-book-save')
      .send({
        projectId: 'p001',
        activeSheetId: 'default',
        rows: [
          { code: '1. 인건비', subCodes: ['1.1 급여'] },
          { code: '2. 운영비', subCodes: ['2.1 소모품'] },
        ],
        renames: [
          {
            fromCode: '1. 인건비',
            fromSub: '1.1 참여인력',
            toCode: '1. 인건비',
            toSub: '1.1 급여',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.codeBook).toEqual([
      { code: '1. 인건비', subCodes: ['1.1 급여'] },
      { code: '2. 운영비', subCodes: ['2.1 소모품'] },
    ]);
    expect(response.body.budgetPlanRows).toEqual([
      expect.objectContaining({ budgetCode: '인건비', subCode: '급여' }),
      expect.objectContaining({ budgetCode: '2. 운영비', subCode: '2.1 소모품' }),
    ]);
    expect(response.body.expenseSheet?.rows?.[0]?.cells?.[5]).toBe('인건비');
    expect(response.body.expenseSheet?.rows?.[0]?.cells?.[6]).toBe('급여');
    expect(response.body.evidenceRequiredMap).toMatchObject({
      '인건비|급여': '계약서',
      '운영비|소모품': '영수증',
    });
    expect(db.docs.get('orgs/mysc/projects/p001/budget_code_book/default')?.codes).toEqual([
      { code: '1. 인건비', subCodes: ['1.1 급여'] },
      { code: '2. 운영비', subCodes: ['2.1 소모품'] },
    ]);
    expect(db.docs.get('orgs/mysc/projects/p001/budget_summary/default')?.rows?.[0]?.subCode).toBe('급여');
    expect(db.docs.get('orgs/mysc/projects/p001/expense_sheets/default')?.rows?.[0]?.cells?.[6]).toBe('급여');
    expect(db.docs.get('orgs/mysc/budgetEvidenceMaps/p001')?.map?.['인건비|급여']).toBe('계약서');
    expect(auditEntries).toHaveLength(1);
  });

  it('saves the base code book without propagation when there are no renames', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/budget/code-book/save')
      .set('idempotency-key', 'idem-budget-code-book-save-no-rename')
      .send({
        projectId: 'p001',
        activeSheetId: 'default',
        rows: [
          { code: '1. 인건비', subCodes: ['1.1 급여'] },
        ],
        renames: [],
      });

    expect(response.status).toBe(200);
    expect(response.body.codeBook).toEqual([
      { code: '1. 인건비', subCodes: ['1.1 급여'] },
    ]);
    expect(response.body.budgetPlanRows).toBeNull();
    expect(response.body.expenseSheet).toBeNull();
    expect(response.body.evidenceRequiredMap).toBeNull();
  });

  it('rejects invalid code-book drafts with the same validation boundary', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/budget/code-book/save')
      .set('idempotency-key', 'idem-budget-code-book-invalid')
      .send({
        projectId: 'p001',
        activeSheetId: 'default',
        rows: [
          { code: '1. 인건비', subCodes: [] },
        ],
        renames: [],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_budget_code_book');
  });
});
