import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalTransactionFinanceWriteCommandRoutes } from './portal-transaction-finance-write-commands.mjs';

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
      requestId: 'req-portal-transaction-finance-write',
      idempotencyKey: 'idem-portal-transaction-finance-write',
    };
    next();
  });

  mountPortalTransactionFinanceWriteCommandRoutes(app, {
    db,
    now: () => '2026-04-17T09:00:00.000Z',
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

describe('portal transaction finance-write command routes', () => {
  it('creates a draft transaction with only portal finance content fields', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': { id: 'p001', name: '알파 프로젝트' },
      'orgs/mysc/ledgers/ledger-1': { id: 'ledger-1', projectId: 'p001', name: '기본 원장' },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/transactions/finance-write')
      .set('idempotency-key', 'idem-finance-write-create')
      .send({
        id: 'tx-100',
        projectId: 'p001',
        ledgerId: 'ledger-1',
        patch: {
          counterparty: '가맹점',
          dateTime: '2026-04-17T08:30:00+09:00',
          weekCode: '2026-W16',
          direction: 'OUT',
          entryKind: 'EXPENSE',
          method: 'CORP_CARD_1',
          cashflowCategory: 'SUPPLIES',
          cashflowLabel: '소모품비',
          budgetCategory: '재료비',
          budgetSubCategory: '소모품',
          budgetSubSubCategory: '기타',
          memo: '복사용지 구매',
          amounts: {
            bankAmount: -55000,
            depositAmount: 0,
            expenseAmount: 55000,
            vatIn: 5000,
            vatOut: 0,
            vatRefund: 0,
            balanceAfter: 945000,
          },
          evidenceRequired: ['영수증'],
          evidenceStatus: 'MISSING',
          evidenceMissing: ['영수증'],
          attachmentsCount: 0,
          evidenceRequiredDesc: '영수증',
          evidenceCompletedDesc: '',
          evidenceCompletedManualDesc: '',
          evidencePendingDesc: '영수증 업로드',
          evidenceDriveLink: 'https://drive.google.com/folderview?id=folder-1',
          evidenceDriveSharedDriveId: 'shared-1',
          evidenceDriveFolderId: 'folder-1',
          evidenceDriveFolderName: 'tx-100',
          evidenceDriveSyncStatus: 'LINKED',
          evidenceDriveLastSyncedAt: '2026-04-17T09:00:00.000Z',
          evidenceAutoListedDesc: '',
          supportPendingDocs: '영수증 확인 필요',
          eNaraRegistered: '',
          eNaraExecuted: '',
          vatSettlementDone: false,
          settlementComplete: false,
          settlementNote: '',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.transaction).toMatchObject({
      id: 'tx-100',
      projectId: 'p001',
      ledgerId: 'ledger-1',
      state: 'DRAFT',
      counterparty: '가맹점',
      memo: '복사용지 구매',
      version: 1,
      createdBy: 'pm-1',
      updatedBy: 'pm-1',
    });
    expect(response.body.transaction.submittedAt).toBeUndefined();
    expect(response.body.transaction.approvedAt).toBeUndefined();
    expect(response.body.summary).toMatchObject({
      id: 'tx-100',
      projectId: 'p001',
      ledgerId: 'ledger-1',
      created: true,
      version: 1,
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('patches an existing draft transaction without taking lifecycle ownership', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': { id: 'p001', name: '알파 프로젝트' },
      'orgs/mysc/ledgers/ledger-1': { id: 'ledger-1', projectId: 'p001', name: '기본 원장' },
      'orgs/mysc/transactions/tx-200': {
        id: 'tx-200',
        tenantId: 'mysc',
        projectId: 'p001',
        ledgerId: 'ledger-1',
        counterparty: '기존 거래처',
        state: 'DRAFT',
        dateTime: '2026-04-17T08:30:00+09:00',
        weekCode: '2026-W16',
        direction: 'OUT',
        method: 'CORP_CARD_1',
        cashflowCategory: 'SUPPLIES',
        cashflowLabel: '소모품비',
        memo: '기존 메모',
        amounts: {
          bankAmount: -30000,
          depositAmount: 0,
          expenseAmount: 30000,
          vatIn: 0,
          vatOut: 0,
          vatRefund: 0,
          balanceAfter: 970000,
        },
        evidenceRequired: [],
        evidenceStatus: 'MISSING',
        evidenceMissing: [],
        attachmentsCount: 0,
        createdBy: 'pm-old',
        createdAt: '2026-04-17T08:00:00.000Z',
        updatedBy: 'pm-old',
        updatedAt: '2026-04-17T08:00:00.000Z',
        version: 3,
        submittedAt: 'should-stay-absent',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/transactions/finance-write')
      .set('idempotency-key', 'idem-finance-write-update')
      .send({
        id: 'tx-200',
        projectId: 'p001',
        ledgerId: 'ledger-1',
        expectedVersion: 3,
        patch: {
          counterparty: '수정 거래처',
          memo: '수정 메모',
          attachmentsCount: 2,
          evidenceStatus: 'PARTIAL',
          evidenceMissing: ['세금계산서'],
          supportPendingDocs: '세금계산서',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.transaction).toMatchObject({
      id: 'tx-200',
      version: 4,
      state: 'DRAFT',
      counterparty: '수정 거래처',
      memo: '수정 메모',
      attachmentsCount: 2,
      evidenceStatus: 'PARTIAL',
      supportPendingDocs: '세금계산서',
      createdBy: 'pm-old',
    });
    expect(response.body.transaction.submittedBy).toBeUndefined();
    expect(response.body.transaction.approvedBy).toBeUndefined();
  });

  it('rejects lifecycle-owned fields in the portal finance patch', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': { id: 'p001', name: '알파 프로젝트' },
      'orgs/mysc/ledgers/ledger-1': { id: 'ledger-1', projectId: 'p001', name: '기본 원장' },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/transactions/finance-write')
      .set('idempotency-key', 'idem-finance-write-reject-state')
      .send({
        id: 'tx-300',
        projectId: 'p001',
        ledgerId: 'ledger-1',
        patch: {
          counterparty: '거래처',
          dateTime: '2026-04-17T08:30:00+09:00',
          weekCode: '2026-W16',
          direction: 'OUT',
          method: 'CORP_CARD_1',
          cashflowCategory: 'SUPPLIES',
          cashflowLabel: '소모품비',
          memo: '메모',
          amounts: {
            bankAmount: -1000,
            depositAmount: 0,
            expenseAmount: 1000,
            vatIn: 0,
            vatOut: 0,
            vatRefund: 0,
            balanceAfter: 999000,
          },
          evidenceRequired: [],
          evidenceStatus: 'MISSING',
          evidenceMissing: [],
          attachmentsCount: 0,
          state: 'SUBMITTED',
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_portal_transaction_finance_write_payload');
  });

  it('rejects ledger/project mismatches', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': { id: 'p001', name: '알파 프로젝트' },
      'orgs/mysc/ledgers/ledger-2': { id: 'ledger-2', projectId: 'p999', name: '다른 원장' },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/transactions/finance-write')
      .set('idempotency-key', 'idem-finance-write-ledger-mismatch')
      .send({
        id: 'tx-400',
        projectId: 'p001',
        ledgerId: 'ledger-2',
        patch: {
          counterparty: '거래처',
          dateTime: '2026-04-17T08:30:00+09:00',
          weekCode: '2026-W16',
          direction: 'OUT',
          method: 'CORP_CARD_1',
          cashflowCategory: 'SUPPLIES',
          cashflowLabel: '소모품비',
          memo: '메모',
          amounts: {
            bankAmount: -1000,
            depositAmount: 0,
            expenseAmount: 1000,
            vatIn: 0,
            vatOut: 0,
            vatRefund: 0,
            balanceAfter: 999000,
          },
          evidenceRequired: [],
          evidenceStatus: 'MISSING',
          evidenceMissing: [],
          attachmentsCount: 0,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('request_error');
  });
});
