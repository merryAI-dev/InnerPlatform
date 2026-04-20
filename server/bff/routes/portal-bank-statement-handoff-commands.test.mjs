import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalBankStatementHandoffCommandRoutes } from './portal-bank-statement-handoff-commands.mjs';

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
      requestId: 'req-bank-handoff',
      idempotencyKey: 'idem-bank-handoff',
    };
    next();
  });

  mountPortalBankStatementHandoffCommandRoutes(app, {
    db,
    now: () => '2026-04-16T15:00:00.000Z',
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

describe('portal bank statement handoff command routes', () => {
  it('persists bank statement, expense sheet handoff, and intake items through one server-owned command', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/projects/p001/expense_sheets/default': {
        id: 'default',
        projectId: 'p001',
        name: '기본 탭',
        rows: [],
        version: 2,
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/bank-statements/handoff')
      .set('idempotency-key', 'idem-bank-handoff')
      .send({
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        columns: ['통장번호', '거래일시', '적요', '의뢰인/수취인', '출금금액', '입금금액', '잔액'],
        rows: [
          {
            tempId: 'bank-1',
            cells: ['111-222', '2026-04-16 09:10', '카드 결제', '가맹점', '120,000', '', '2,340,000'],
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.bankStatement).toMatchObject({
      rowCount: 1,
      columnCount: 7,
    });
    expect(response.body.sheet).toMatchObject({
      id: 'default',
      projectId: 'p001',
      rowCount: 1,
      version: 3,
    });
    expect(Array.isArray(response.body.rows)).toBe(true);
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].sourceTxId).toMatch(/^bank:/);
    expect(Array.isArray(response.body.rows[0].cells)).toBe(true);
    expect(response.body.rows[0].cells.length).toBeGreaterThan(20);
    expect(Array.isArray(response.body.expenseIntakeItems)).toBe(true);
    expect(response.body.expenseIntakeItems).toHaveLength(1);
    expect(response.body.expenseIntakeItems[0]).toMatchObject({
      projectId: 'p001',
      sourceTxId: expect.stringMatching(/^bank:/),
      matchState: expect.any(String),
      projectionStatus: expect.any(String),
      evidenceStatus: expect.any(String),
      manualFields: {},
      bankFingerprint: expect.any(String),
      bankSnapshot: {
        dateTime: expect.any(String),
      },
    });
    expect(db.docs.get('orgs/mysc/projects/p001/bank_statements/default')?.rowCount).toBe(1);
    expect(db.docs.get('orgs/mysc/projects/p001/expense_sheets/default')?.rowCount).toBe(1);
    expect(db.docs.get('orgs/mysc/projects/p001/expense_sheets/default')?.rows?.[0]?.sourceTxId).toMatch(/^bank:/);
    expect(auditEntries).toHaveLength(1);
  });

  it('returns 404 when the target project is missing', async () => {
    const app = createApp(createFakeDb(), []);

    const response = await request(app)
      .post('/api/v1/portal/bank-statements/handoff')
      .set('idempotency-key', 'idem-bank-handoff-missing-project')
      .send({
        projectId: 'p001',
        activeSheetId: 'default',
        activeSheetName: '기본 탭',
        order: 0,
        columns: ['통장번호', '거래일시'],
        rows: [],
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('project_not_found');
  });
});
