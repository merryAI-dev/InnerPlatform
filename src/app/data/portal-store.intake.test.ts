import { describe, expect, it } from 'vitest';
import type { BankImportIntakeItem } from './types';
import {
  buildBankImportIntakeDoc,
  mergeBankImportIntakeItem,
  normalizeBankImportIntakeItem,
  reconcileBankImportUploadItems,
  serializeBankImportIntakeItemForPersistence,
} from './portal-store.intake';

function makeItem(overrides: Partial<BankImportIntakeItem> = {}): BankImportIntakeItem {
  return {
    id: 'fp-1',
    projectId: 'p-1',
    sourceTxId: 'bank:fp-1',
    bankFingerprint: 'fp-1',
    bankSnapshot: {
      accountNumber: '111-222-333',
      dateTime: '2026-04-06',
      counterparty: '메리 사업팀',
      memo: '법인카드 결제',
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
      cashflowCategory: 'TRAVEL',
      memo: '현장 이동',
      evidenceCompletedDesc: '',
    },
    existingExpenseSheetId: 'default',
    existingExpenseRowTempId: 'row-1',
    reviewReasons: ['duplicate candidate'],
    lastUploadBatchId: 'batch-1',
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
    updatedBy: 'pm',
    ...overrides,
  };
}

describe('portal-store intake persistence', () => {
  it('serializes intake items without losing manual fields', () => {
    const serialized = serializeBankImportIntakeItemForPersistence(makeItem());

    expect(serialized).toMatchObject({
      sourceTxId: 'bank:fp-1',
      bankFingerprint: 'fp-1',
      matchState: 'PENDING_INPUT',
      projectionStatus: 'NOT_PROJECTED',
      evidenceStatus: 'MISSING',
      manualFields: {
        expenseAmount: 120000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'TRAVEL',
        memo: '현장 이동',
        evidenceCompletedDesc: '',
      },
      reviewReasons: ['duplicate candidate'],
    });
  });

  it('normalizes persisted intake docs back into runtime shape', () => {
    const normalized = normalizeBankImportIntakeItem({
      id: 'fp-1',
      projectId: 'p-1',
      sourceTxId: 'bank:fp-1',
      bankFingerprint: 'fp-1',
      bankSnapshot: {
        accountNumber: '111-222-333',
        dateTime: '2026-04-06',
        counterparty: '메리 사업팀',
        memo: '법인카드 결제',
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
        cashflowCategory: 'TRAVEL',
      },
      reviewReasons: ['duplicate candidate'],
      lastUploadBatchId: 'batch-1',
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
      updatedBy: 'pm',
    });

    expect(normalized).toEqual(expect.objectContaining({
      id: 'fp-1',
      sourceTxId: 'bank:fp-1',
      manualFields: expect.objectContaining({
        budgetCategory: '여비',
        cashflowCategory: 'TRAVEL',
      }),
    }));
  });

  it('builds a Firestore doc with tenant scope and stable optional fields', () => {
    const built = buildBankImportIntakeDoc({
      orgId: 'mysc',
      item: makeItem({
        existingExpenseSheetId: undefined,
        existingExpenseRowTempId: undefined,
        manualFields: {},
        reviewReasons: [],
      }),
    });

    expect(built).toMatchObject({
      tenantId: 'mysc',
      id: 'fp-1',
      projectId: 'p-1',
      sourceTxId: 'bank:fp-1',
      bankFingerprint: 'fp-1',
      manualFields: {},
      reviewReasons: [],
    });
    expect(built).not.toHaveProperty('existingExpenseSheetId');
    expect(built).not.toHaveProperty('existingExpenseRowTempId');
  });

  it('merges projection draft updates without dropping existing manual fields', () => {
    const merged = mergeBankImportIntakeItem(makeItem({
      manualFields: {
        expenseAmount: 120000,
        budgetCategory: '여비',
        budgetSubCategory: '',
        cashflowCategory: 'TRAVEL',
        memo: '기존 메모',
      },
    }), {
      manualFields: {
        budgetSubCategory: '교통비',
        evidenceCompletedDesc: '출장신청서',
      },
      updatedAt: '2026-04-06T01:00:00.000Z',
    });

    expect(merged).toEqual(expect.objectContaining({
      updatedAt: '2026-04-06T01:00:00.000Z',
      manualFields: expect.objectContaining({
        expenseAmount: 120000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'TRAVEL',
        memo: '기존 메모',
        evidenceCompletedDesc: '출장신청서',
      }),
    }));
  });

  it('preserves the latest manual fields when a bank upload rebuilds an existing intake item', () => {
    const current = makeItem({
      manualFields: {
        expenseAmount: 120000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'TRAVEL',
        cashflowLineId: 'DIRECT_COST_OUT',
        memo: '사람이 직접 수정한 메모',
        evidenceCompletedDesc: '출장신청서',
      },
      updatedAt: '2026-04-06T01:00:00.000Z',
    });
    const rebuilt = makeItem({
      bankSnapshot: {
        accountNumber: '111-222-333',
        dateTime: '2026-04-06 10:00',
        counterparty: '메리 사업팀',
        memo: '재업로드된 통장 메모',
        signedAmount: -120000,
        balanceAfter: 890000,
      },
      manualFields: {},
      evidenceStatus: 'MISSING',
      updatedAt: '2026-04-06T02:00:00.000Z',
      lastUploadBatchId: 'batch-2',
    });

    const reconciled = reconcileBankImportUploadItems([current], [rebuilt]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toEqual(expect.objectContaining({
      bankSnapshot: expect.objectContaining({
        memo: '재업로드된 통장 메모',
        balanceAfter: 890000,
      }),
      lastUploadBatchId: 'batch-2',
      manualFields: expect.objectContaining({
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowLineId: 'DIRECT_COST_OUT',
        memo: '사람이 직접 수정한 메모',
        evidenceCompletedDesc: '출장신청서',
      }),
      evidenceStatus: 'MISSING',
    }));
  });
});
