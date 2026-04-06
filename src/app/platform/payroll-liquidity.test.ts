import { describe, expect, it } from 'vitest';
import type { PayrollRun, Project, Transaction } from '../data/types';
import {
  isPayrollLiquidityRiskStatus,
  resolveProjectPayrollLiquidity,
  resolvePayrollLiquidityQueue,
} from './payroll-liquidity';

function createProject(id: string, name = '테스트 사업'): Project {
  return {
    id,
    tenantId: 'org-1',
    shortName: id,
    name,
    clientOrg: '',
    department: 'AC',
    type: 'A1',
    phase: 'CONFIRMED',
    status: 'IN_PROGRESS',
    contractAmount: 0,
    salesVatAmount: 0,
    totalRevenueAmount: 0,
    supportAmount: 0,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'TYPE1',
    basis: '공급가액',
    accountType: 'OPERATING',
    paymentPlanDesc: '',
    settlementGuide: '',
    projectPurpose: '',
    managerName: '',
    teamName: '',
    teamMembers: '',
    participantCondition: '',
    note: '',
    contractDocument: null,
    budgetCurrentYear: 0,
    budgetTotal: 0,
    taxInvoiceAmount: 0,
    currentYearSales: 0,
    currentYearInvoiced: 0,
    outstandingReceivables: 0,
    expectedDepositDate: '',
    profitAmount: 0,
    profitRate: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createRun(input: Partial<PayrollRun> & Pick<PayrollRun, 'id' | 'projectId' | 'yearMonth' | 'plannedPayDate'>): PayrollRun {
  return {
    tenantId: 'org-1',
    noticeDate: '2026-03-22',
    noticeLeadBusinessDays: 3,
    acknowledged: false,
    paidStatus: 'UNKNOWN',
    matchedTxIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...input,
  };
}

function createTransaction(input: Partial<Transaction> & Pick<Transaction, 'id' | 'projectId' | 'dateTime' | 'amounts'>): Transaction {
  return {
    ledgerId: 'ledger-1',
    state: 'APPROVED',
    weekCode: '2026-W13',
    direction: 'OUT',
    method: 'TRANSFER',
    cashflowCategory: 'LABOR_COST',
    cashflowLabel: '인건비',
    counterparty: '메리',
    memo: '',
    evidenceRequired: [],
    evidenceStatus: 'COMPLETE',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'u1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...input,
  };
}

describe('payroll-liquidity', () => {
  it('uses the latest confirmed payroll run as the expected payroll baseline', () => {
    const project = createProject('p-1');
    const baselineTx = createTransaction({
      id: 'tx-baseline',
      projectId: project.id,
      dateTime: '2026-02-25',
      amounts: { bankAmount: 5000000, depositAmount: 0, expenseAmount: 5000000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 9000000 },
    });
    const currentRun = createRun({
      id: 'run-current',
      projectId: project.id,
      yearMonth: '2026-03',
      plannedPayDate: '2026-03-25',
      paidStatus: 'UNKNOWN',
    });
    const baselineRun = createRun({
      id: 'run-prev',
      projectId: project.id,
      yearMonth: '2026-02',
      plannedPayDate: '2026-02-25',
      paidStatus: 'CONFIRMED',
      matchedTxIds: [baselineTx.id],
    });

    const [item] = resolveProjectPayrollLiquidity({
      project,
      runs: [baselineRun, currentRun],
      transactions: [baselineTx],
      today: '2026-03-24',
    });

    expect(item.expectedPayrollAmount).toBe(5000000);
    expect(item.baselineRunId).toBe(baselineRun.id);
  });

  it('marks the queue as baseline_missing when no prior confirmed payroll exists', () => {
    const project = createProject('p-1');
    const currentRun = createRun({
      id: 'run-current',
      projectId: project.id,
      yearMonth: '2026-03',
      plannedPayDate: '2026-03-25',
    });

    const [item] = resolveProjectPayrollLiquidity({
      project,
      runs: [currentRun],
      transactions: [],
      today: '2026-03-24',
    });

    expect(item.status).toBe('baseline_missing');
    expect(isPayrollLiquidityRiskStatus(item.status)).toBe(false);
  });

  it('marks the queue as insufficient_balance when any day in D-3..D+3 falls below the baseline', () => {
    const project = createProject('p-1');
    const baselineTx = createTransaction({
      id: 'tx-baseline',
      projectId: project.id,
      dateTime: '2026-02-25',
      amounts: { bankAmount: 4000000, depositAmount: 0, expenseAmount: 4000000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 8500000 },
    });
    const balanceTx = createTransaction({
      id: 'tx-balance',
      projectId: project.id,
      dateTime: '2026-03-23',
      amounts: { bankAmount: 1000000, depositAmount: 0, expenseAmount: 1000000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 2500000 },
    });
    const currentRun = createRun({
      id: 'run-current',
      projectId: project.id,
      yearMonth: '2026-03',
      plannedPayDate: '2026-03-25',
    });
    const baselineRun = createRun({
      id: 'run-prev',
      projectId: project.id,
      yearMonth: '2026-02',
      plannedPayDate: '2026-02-25',
      paidStatus: 'CONFIRMED',
      matchedTxIds: [baselineTx.id],
    });

    const [item] = resolveProjectPayrollLiquidity({
      project,
      runs: [baselineRun, currentRun],
      transactions: [baselineTx, balanceTx],
      today: '2026-03-24',
    });

    expect(item.status).toBe('insufficient_balance');
    expect(item.worstBalance).toBe(2500000);
  });

  it('marks the queue as payment_unconfirmed after the planned pay date when balance is sufficient', () => {
    const project = createProject('p-1');
    const baselineTx = createTransaction({
      id: 'tx-baseline',
      projectId: project.id,
      dateTime: '2026-02-25',
      amounts: { bankAmount: 3000000, depositAmount: 0, expenseAmount: 3000000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 9000000 },
    });
    const balanceTx = createTransaction({
      id: 'tx-balance',
      projectId: project.id,
      dateTime: '2026-03-24',
      amounts: { bankAmount: 500000, depositAmount: 0, expenseAmount: 500000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 7000000 },
    });
    const currentRun = createRun({
      id: 'run-current',
      projectId: project.id,
      yearMonth: '2026-03',
      plannedPayDate: '2026-03-25',
    });
    const baselineRun = createRun({
      id: 'run-prev',
      projectId: project.id,
      yearMonth: '2026-02',
      plannedPayDate: '2026-02-25',
      paidStatus: 'CONFIRMED',
      matchedTxIds: [baselineTx.id],
    });

    const [item] = resolveProjectPayrollLiquidity({
      project,
      runs: [baselineRun, currentRun],
      transactions: [baselineTx, balanceTx],
      today: '2026-03-26',
    });

    expect(item.status).toBe('payment_unconfirmed');
    expect(isPayrollLiquidityRiskStatus(item.status)).toBe(true);
  });

  it('carries the latest known balance forward across the D-3..D+3 strip', () => {
    const project = createProject('p-1');
    const baselineTx = createTransaction({
      id: 'tx-baseline',
      projectId: project.id,
      dateTime: '2026-02-25',
      amounts: { bankAmount: 2000000, depositAmount: 0, expenseAmount: 2000000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 6000000 },
    });
    const balanceTx = createTransaction({
      id: 'tx-balance',
      projectId: project.id,
      dateTime: '2026-03-22',
      amounts: { bankAmount: 300000, depositAmount: 0, expenseAmount: 300000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 5500000 },
    });
    const currentRun = createRun({
      id: 'run-current',
      projectId: project.id,
      yearMonth: '2026-03',
      plannedPayDate: '2026-03-25',
    });
    const baselineRun = createRun({
      id: 'run-prev',
      projectId: project.id,
      yearMonth: '2026-02',
      plannedPayDate: '2026-02-25',
      paidStatus: 'CONFIRMED',
      matchedTxIds: [baselineTx.id],
    });

    const [item] = resolveProjectPayrollLiquidity({
      project,
      runs: [baselineRun, currentRun],
      transactions: [baselineTx, balanceTx],
      today: '2026-03-24',
    });

    expect(item.dayBalances.find((entry) => entry.date === '2026-03-23')?.balance).toBe(5500000);
    expect(item.dayBalances.find((entry) => entry.date === '2026-03-28')?.balance).toBe(5500000);
  });

  it('includes next-month runs when today falls inside their active window', () => {
    const project = createProject('p-1');
    const baselineTx = createTransaction({
      id: 'tx-baseline',
      projectId: project.id,
      dateTime: '2026-03-01',
      amounts: { bankAmount: 2500000, depositAmount: 0, expenseAmount: 2500000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 8000000 },
    });
    const nextRun = createRun({
      id: 'run-next',
      projectId: project.id,
      yearMonth: '2026-04',
      plannedPayDate: '2026-04-01',
    });
    const baselineRun = createRun({
      id: 'run-prev',
      projectId: project.id,
      yearMonth: '2026-03',
      plannedPayDate: '2026-03-01',
      paidStatus: 'CONFIRMED',
      matchedTxIds: [baselineTx.id],
    });

    const items = resolvePayrollLiquidityQueue({
      projects: [project],
      runs: [baselineRun, nextRun],
      transactions: [baselineTx],
      today: '2026-03-30',
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.runId).toBe(nextRun.id);
  });
});
