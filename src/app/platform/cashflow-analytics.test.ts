import { describe, expect, it } from 'vitest';
import {
  buildCashflowAnalytics,
  type CashflowAnalyticsFilters,
} from './cashflow-analytics';
import type { Project, Transaction } from '../data/types';

function project(overrides: Partial<Project> & Pick<Project, 'id' | 'name' | 'type' | 'department'>): Project {
  return {
    id: overrides.id,
    slug: overrides.id,
    orgId: 'mysc',
    name: overrides.name,
    status: 'IN_PROGRESS',
    type: overrides.type,
    phase: 'CONFIRMED',
    contractAmount: 0,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'NONE',
    basis: 'NONE',
    accountType: 'OPERATING',
    paymentPlan: { contract: 0, interim: 0, final: 0 },
    paymentPlanDesc: '',
    clientOrg: '',
    groupwareName: '',
    participantCondition: '',
    contractType: '',
    department: overrides.department,
    teamName: '',
    managerId: '',
    managerName: '',
    budgetCurrentYear: 0,
    taxInvoiceAmount: 0,
    profitRate: 0,
    profitAmount: 0,
    isSettled: false,
    finalPaymentNote: '',
    confirmerName: '',
    lastCheckedAt: '',
    cashflowDiffNote: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'id' | 'projectId' | 'dateTime' | 'direction' | 'cashflowCategory'>): Transaction {
  const bankAmount = overrides.amounts?.bankAmount ?? 0;
  return {
    id: overrides.id,
    ledgerId: `ledger-${overrides.projectId}`,
    projectId: overrides.projectId,
    state: 'APPROVED',
    dateTime: overrides.dateTime,
    weekCode: '2026-W01',
    direction: overrides.direction,
    method: 'TRANSFER',
    cashflowCategory: overrides.cashflowCategory,
    cashflowLabel: '',
    counterparty: '',
    memo: '',
    amounts: {
      bankAmount,
      depositAmount: overrides.direction === 'IN' ? bankAmount : 0,
      expenseAmount: overrides.direction === 'OUT' ? bankAmount : 0,
      vatIn: 0,
      vatOut: 0,
      vatRefund: 0,
      balanceAfter: 0,
      ...overrides.amounts,
    },
    evidenceRequired: [],
    evidenceStatus: 'COMPLETE',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedBy: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('cashflow analytics', () => {
  const projects = [
    project({ id: 'p-consulting', name: '컨설팅 사업', type: 'C1', department: '컨설팅팀' }),
    project({ id: 'p-global', name: '글로벌 사업', type: 'A2', department: '글로벌팀' }),
  ];

  const transactions = [
    tx({
      id: 'in-1',
      projectId: 'p-consulting',
      dateTime: '2026-01-05',
      direction: 'IN',
      cashflowCategory: 'CONTRACT_PAYMENT',
      amounts: { bankAmount: 11_000_000, depositAmount: 11_000_000, vatOut: 1_000_000, expenseAmount: 0, vatIn: 0, vatRefund: 0, balanceAfter: 11_000_000 },
    }),
    tx({
      id: 'out-1',
      projectId: 'p-consulting',
      dateTime: '2026-01-10',
      direction: 'OUT',
      cashflowCategory: 'OUTSOURCING',
      amounts: { bankAmount: 3_300_000, depositAmount: 0, expenseAmount: 3_000_000, vatIn: 300_000, vatOut: 0, vatRefund: 0, balanceAfter: 7_700_000 },
    }),
    tx({
      id: 'refund-1',
      projectId: 'p-consulting',
      dateTime: '2026-02-03',
      direction: 'IN',
      cashflowCategory: 'VAT_REFUND',
      amounts: { bankAmount: 200_000, depositAmount: 200_000, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 200_000, balanceAfter: 7_900_000 },
    }),
    tx({
      id: 'other-1',
      projectId: 'p-global',
      dateTime: '2026-01-15',
      direction: 'OUT',
      cashflowCategory: 'TRAVEL',
      state: 'SUBMITTED',
      amounts: { bankAmount: 900_000, depositAmount: 0, expenseAmount: 900_000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    }),
  ];

  it('filters bank transactions by project, date range, direction, state, and category', () => {
    const filters: CashflowAnalyticsFilters = {
      projectId: 'p-consulting',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      direction: 'OUT',
      state: 'APPROVED',
      cashflowCategory: 'OUTSOURCING',
    };

    const analytics = buildCashflowAnalytics({ transactions, projects, filters });

    expect(analytics.transactions.map((item) => item.id)).toEqual(['out-1']);
    expect(analytics.totals).toMatchObject({
      totalIn: 0,
      totalOut: 3_300_000,
      net: -3_300_000,
      expenseAmount: 3_000_000,
      inputVat: 300_000,
      outputVat: 0,
      withholdingBalance: -300_000,
      count: 1,
      approved: 1,
    });
  });

  it('summarizes tax and deposit-balance review amounts across the filtered transaction set', () => {
    const analytics = buildCashflowAnalytics({
      transactions,
      projects,
      filters: { projectId: 'p-consulting' },
    });

    expect(analytics.totals).toMatchObject({
      totalIn: 11_200_000,
      totalOut: 3_300_000,
      net: 7_900_000,
      depositAmount: 11_200_000,
      expenseAmount: 3_000_000,
      inputVat: 300_000,
      outputVat: 1_000_000,
      vatRefund: 200_000,
      withholdingBalance: 500_000,
      count: 3,
      approved: 3,
    });
    expect(analytics.projectRows).toEqual([
      expect.objectContaining({
        projectId: 'p-consulting',
        name: '컨설팅 사업',
        totalIn: 11_200_000,
        totalOut: 3_300_000,
        net: 7_900_000,
        expenseAmount: 3_000_000,
        inputVat: 300_000,
        outputVat: 1_000_000,
        withholdingBalance: 500_000,
        count: 3,
      }),
    ]);
  });
});
