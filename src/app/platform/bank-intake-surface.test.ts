import { describe, expect, it } from 'vitest';
import type { BankImportIntakeItem } from '../data/types';
import { groupExpenseIntakeItemsForSurface, resolveBankImportWizardStatus } from './bank-intake-surface';

function makeItem(overrides: Partial<BankImportIntakeItem> = {}): BankImportIntakeItem {
  return {
    id: 'intake-1',
    projectId: 'p-1',
    sourceTxId: 'bank:fp-1',
    bankFingerprint: 'fp-1',
    bankSnapshot: {
      accountNumber: '111',
      dateTime: '2026-04-06 09:00',
      counterparty: '코레일',
      memo: 'KTX',
      signedAmount: -15000,
      balanceAfter: 500000,
    },
    matchState: 'PENDING_INPUT',
    projectionStatus: 'NOT_PROJECTED',
    evidenceStatus: 'MISSING',
    manualFields: {},
    reviewReasons: [],
    lastUploadBatchId: 'batch-1',
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
    updatedBy: 'pm',
    ...overrides,
  };
}

describe('resolveBankImportWizardStatus', () => {
  it('returns PROJECTED_PENDING_EVIDENCE when projection succeeded but evidence is missing', () => {
    expect(resolveBankImportWizardStatus(makeItem({
      matchState: 'AUTO_CONFIRMED',
      projectionStatus: 'PROJECTED_WITH_PENDING_EVIDENCE',
      evidenceStatus: 'MISSING',
      manualFields: {
        expenseAmount: 15000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'TRAVEL',
      },
    }))).toBe('PROJECTED_PENDING_EVIDENCE');
  });
});

describe('groupExpenseIntakeItemsForSurface', () => {
  it('groups intake items into classification, review, and evidence continuation buckets', () => {
    const grouped = groupExpenseIntakeItemsForSurface([
      makeItem(),
      makeItem({ id: 'review', matchState: 'REVIEW_REQUIRED', reviewReasons: ['collision'] }),
      makeItem({
        id: 'evidence',
        matchState: 'AUTO_CONFIRMED',
        projectionStatus: 'PROJECTED_WITH_PENDING_EVIDENCE',
        evidenceStatus: 'MISSING',
        manualFields: {
          expenseAmount: 15000,
          budgetCategory: '여비',
          budgetSubCategory: '교통비',
          cashflowCategory: 'TRAVEL',
        },
      }),
    ]);

    expect(grouped.needsClassification).toHaveLength(1);
    expect(grouped.reviewRequired).toHaveLength(1);
    expect(grouped.pendingEvidence).toHaveLength(1);
  });
});
