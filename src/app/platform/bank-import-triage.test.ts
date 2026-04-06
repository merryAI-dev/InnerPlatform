import { describe, expect, it } from 'vitest';
import type { BankImportIntakeItem } from '../data/types';
import {
  buildBankFingerprint,
  isBankImportManualFieldsComplete,
  resolveBankImportMatchState,
  resolveBankImportProjectionStatus,
  selectWizardIntakeItems,
} from './bank-import-triage';

function makeSnapshot(overrides: Partial<BankImportIntakeItem['bankSnapshot']> = {}): BankImportIntakeItem['bankSnapshot'] {
  return {
    accountNumber: '111-222-333',
    dateTime: '2026-04-06',
    counterparty: '메리 사업팀',
    memo: '법인카드 결제',
    signedAmount: -120000,
    balanceAfter: 910000,
    ...overrides,
  };
}

describe('bank-import-triage', () => {
  it('builds the same fingerprint for the same bank transaction regardless of row order context', () => {
    const first = buildBankFingerprint(makeSnapshot());
    const second = buildBankFingerprint(makeSnapshot({
      counterparty: '  메리   사업팀 ',
      memo: '법인카드   결제',
    }));

    expect(first).toBe(second);
    expect(first).not.toHaveLength(0);
  });

  it('marks a transaction as PENDING_INPUT when required manual fields are incomplete', () => {
    const matchState = resolveBankImportMatchState({
      fingerprint: 'fp-1',
      incomingSourceTxId: 'bank:fp-1',
      bankSnapshot: makeSnapshot(),
      manualFields: {
        expenseAmount: 120000,
        budgetCategory: '여비',
      },
    });

    expect(matchState).toBe('PENDING_INPUT');
    expect(isBankImportManualFieldsComplete({
      expenseAmount: 120000,
      budgetCategory: '여비',
    })).toBe(false);
  });

  it('marks a transaction as AUTO_CONFIRMED when the same projected source id can be safely refreshed', () => {
    const matchState = resolveBankImportMatchState({
      fingerprint: 'fp-2',
      incomingSourceTxId: 'bank:fp-2',
      bankSnapshot: makeSnapshot(),
      existingItem: {
        id: 'fp-2',
        projectId: 'p-1',
        sourceTxId: 'bank:fp-2',
        bankFingerprint: 'fp-2',
        bankSnapshot: makeSnapshot(),
        matchState: 'AUTO_CONFIRMED',
        projectionStatus: 'PROJECTED',
        evidenceStatus: 'PARTIAL',
        manualFields: {
          expenseAmount: 120000,
          budgetCategory: '여비',
          budgetSubCategory: '교통비',
          cashflowCategory: 'TRAVEL',
        },
        reviewReasons: [],
        lastUploadBatchId: 'batch-1',
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
        updatedBy: 'pm',
      },
    });

    expect(matchState).toBe('AUTO_CONFIRMED');
  });

  it('marks a transaction as REVIEW_REQUIRED when a key bank snapshot field drifts', () => {
    const matchState = resolveBankImportMatchState({
      fingerprint: 'fp-3',
      incomingSourceTxId: 'bank:fp-3',
      bankSnapshot: makeSnapshot({ signedAmount: -130000 }),
      existingItem: {
        id: 'fp-3',
        projectId: 'p-1',
        sourceTxId: 'bank:fp-3',
        bankFingerprint: 'fp-3',
        bankSnapshot: makeSnapshot({ signedAmount: -120000 }),
        matchState: 'AUTO_CONFIRMED',
        projectionStatus: 'PROJECTED',
        evidenceStatus: 'COMPLETE',
        manualFields: {
          expenseAmount: 120000,
          budgetCategory: '여비',
          budgetSubCategory: '교통비',
          cashflowCategory: 'TRAVEL',
        },
        reviewReasons: [],
        lastUploadBatchId: 'batch-1',
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
        updatedBy: 'pm',
      },
    });

    expect(matchState).toBe('REVIEW_REQUIRED');
  });

  it('allows projection with pending evidence once manual fields are complete', () => {
    const projectionStatus = resolveBankImportProjectionStatus({
      matchState: 'AUTO_CONFIRMED',
      manualFields: {
        expenseAmount: 120000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'TRAVEL',
      },
      evidenceStatus: 'MISSING',
    });

    expect(projectionStatus).toBe('PROJECTED_WITH_PENDING_EVIDENCE');
  });

  it('selects only pending-input and review-required items for the wizard', () => {
    const items: BankImportIntakeItem[] = [
      {
        id: 'a',
        projectId: 'p-1',
        sourceTxId: 'bank:a',
        bankFingerprint: 'a',
        bankSnapshot: makeSnapshot({ dateTime: '2026-04-01' }),
        matchState: 'AUTO_CONFIRMED',
        projectionStatus: 'PROJECTED',
        evidenceStatus: 'COMPLETE',
        manualFields: {
          expenseAmount: 1000,
          budgetCategory: '소모품비',
          budgetSubCategory: '기타',
          cashflowCategory: 'SUPPLIES',
        },
        reviewReasons: [],
        lastUploadBatchId: 'batch-1',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        updatedBy: 'pm',
      },
      {
        id: 'b',
        projectId: 'p-1',
        sourceTxId: 'bank:b',
        bankFingerprint: 'b',
        bankSnapshot: makeSnapshot({ dateTime: '2026-04-02' }),
        matchState: 'PENDING_INPUT',
        projectionStatus: 'NOT_PROJECTED',
        evidenceStatus: 'MISSING',
        manualFields: {},
        reviewReasons: [],
        lastUploadBatchId: 'batch-1',
        createdAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        updatedBy: 'pm',
      },
      {
        id: 'c',
        projectId: 'p-1',
        sourceTxId: 'bank:c',
        bankFingerprint: 'c',
        bankSnapshot: makeSnapshot({ dateTime: '2026-04-03' }),
        matchState: 'REVIEW_REQUIRED',
        projectionStatus: 'NOT_PROJECTED',
        evidenceStatus: 'PARTIAL',
        manualFields: {},
        reviewReasons: ['amount drift'],
        lastUploadBatchId: 'batch-1',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        updatedBy: 'pm',
      },
    ];

    expect(selectWizardIntakeItems(items).map((item) => item.id)).toEqual(['c', 'b']);
  });
});
