import { describe, expect, it } from 'vitest';
import type { Transaction } from '../data/types';
import {
  buildTransactionEditHistoryEntries,
  findLatestFieldEdit,
} from './settlement-grid-helpers';

function makeTransaction(): Transaction {
  return {
    id: 'tx-1',
    ledgerId: 'ledger-1',
    projectId: 'project-1',
    state: 'SUBMITTED',
    dateTime: '2026-03-23',
    weekCode: '2026-W12',
    direction: 'OUT',
    method: 'TRANSFER',
    cashflowCategory: 'OUTSOURCING',
    cashflowLabel: '직접사업비',
    counterparty: '거래처',
    memo: '메모',
    amounts: {
      bankAmount: 100000,
      depositAmount: 0,
      expenseAmount: 100000,
      vatIn: 10000,
      vatOut: 0,
      vatRefund: 0,
      balanceAfter: 900000,
    },
    evidenceRequired: [],
    evidenceStatus: 'MISSING',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: 'seed',
    createdAt: '2026-03-23T01:00:00.000Z',
    updatedBy: 'seed',
    updatedAt: '2026-03-23T01:00:00.000Z',
  };
}

describe('settlement-grid-helpers', () => {
  it('builds nested audit entries for expense amount changes', () => {
    const existing = makeTransaction();

    const entries = buildTransactionEditHistoryEntries(
      existing,
      {
        amounts: {
          ...existing.amounts,
          expenseAmount: 80000,
        },
      },
      '보람',
      '2026-03-23T02:00:00.000Z',
    );

    expect(entries).toEqual([
      {
        field: 'amounts.expenseAmount',
        before: 100000,
        after: 80000,
        editedBy: '보람',
        editedAt: '2026-03-23T02:00:00.000Z',
      },
    ]);
  });

  it('finds the latest audit entry for a field', () => {
    const transaction = makeTransaction();
    transaction.editHistory = [
      {
        field: 'amounts.expenseAmount',
        before: 100000,
        after: 90000,
        editedBy: '초기수정자',
        editedAt: '2026-03-23T02:00:00.000Z',
      },
      {
        field: 'memo',
        before: '메모',
        after: '메모 수정',
        editedBy: '다른수정자',
        editedAt: '2026-03-23T03:00:00.000Z',
      },
      {
        field: 'amounts.expenseAmount',
        before: 90000,
        after: 75000,
        editedBy: '최종수정자',
        editedAt: '2026-03-23T04:00:00.000Z',
      },
    ];

    expect(findLatestFieldEdit(transaction, 'amounts.expenseAmount')).toEqual({
      field: 'amounts.expenseAmount',
      before: 90000,
      after: 75000,
      editedBy: '최종수정자',
      editedAt: '2026-03-23T04:00:00.000Z',
    });
  });
});
