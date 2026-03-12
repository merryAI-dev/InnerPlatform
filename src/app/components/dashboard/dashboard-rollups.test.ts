import { describe, expect, it } from 'vitest';
import { validateProject } from './DashboardGuide';
import { buildDashboardCashflowRollups } from './dashboard-rollups';
import type { CashflowWeekSheet, Project, Transaction } from '../../data/types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    version: 1,
    slug: 'project-1',
    orgId: 'mysc',
    name: '테스트 사업',
    status: 'IN_PROGRESS',
    type: 'A1',
    phase: 'CONFIRMED',
    contractAmount: 1000000,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'TYPE1',
    basis: 'SUPPLY_AMOUNT',
    accountType: 'DEDICATED',
    paymentPlan: { contract: 500000, interim: 300000, final: 200000 },
    paymentPlanDesc: '계약 50%, 중도 30%, 잔금 20%',
    clientOrg: '고객사',
    groupwareName: '테스트 사업',
    participantCondition: '',
    contractType: '표준',
    department: '사업팀',
    teamName: 'A팀',
    managerId: 'pm-1',
    managerName: 'PM',
    budgetCurrentYear: 900000,
    taxInvoiceAmount: 100000,
    profitRate: 0.12,
    profitAmount: 120000,
    isSettled: false,
    finalPaymentNote: '',
    confirmerName: '센터장',
    lastCheckedAt: '2026-02-10T00:00:00.000Z',
    cashflowDiffNote: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    version: 1,
    projectId: 'project-1',
    ledgerId: 'ledger-1',
    dateTime: '2026-03-03',
    weekCode: '2026-W10',
    direction: 'IN',
    method: 'TRANSFER',
    state: 'APPROVED',
    cashflowCategory: 'CONTRACT_PAYMENT',
    cashflowLabel: '계약금',
    counterparty: '거래처',
    memo: '',
    amounts: {
      supplyAmount: 1000000,
      vatIn: 0,
      vatOut: 0,
      depositAmount: 1000000,
      expenseAmount: 0,
      bankAmount: 1000000,
    },
    evidenceRequired: [],
    evidenceStatus: 'COMPLETE',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: 'user-1',
    createdAt: '2026-03-03T00:00:00.000Z',
    updatedBy: 'user-1',
    updatedAt: '2026-03-03T00:00:00.000Z',
    ...overrides,
  };
}

function makeWeek(overrides: Partial<CashflowWeekSheet> = {}): CashflowWeekSheet {
  return {
    id: 'project-1-2026-03-w1',
    tenantId: 'mysc',
    projectId: 'project-1',
    yearMonth: '2026-03',
    weekNo: 1,
    weekStart: '2026-03-02',
    weekEnd: '2026-03-08',
    projection: { SALES_IN: 800000, DIRECT_COST_OUT: 200000 },
    actual: { SALES_IN: 700000, DIRECT_COST_OUT: 250000 },
    pmSubmitted: true,
    adminClosed: false,
    createdAt: '2026-03-02T00:00:00.000Z',
    updatedAt: '2026-03-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('dashboard rollups', () => {
  it('handles missing contractAmount in validation without throwing', () => {
    const project = makeProject({
      contractAmount: undefined as unknown as number,
    });

    expect(() => validateProject(project, [makeTransaction()], true)).not.toThrow();

    const validation = validateProject(project, [makeTransaction()], true);
    const amountCheck = validation.checks.find((item) => item.id === 'amount-in-match');
    expect(amountCheck?.detail).toBe('계약금액 미확정');
  });

  it('aggregates approved transactions and sheet totals across projects', () => {
    const projectA = makeProject();
    const projectB = makeProject({
      id: 'project-2',
      slug: 'project-2',
      name: '두번째 사업',
      contractAmount: 2000000,
    });
    const txIn = makeTransaction();
    const txOut = makeTransaction({
      id: 'tx-2',
      direction: 'OUT',
      amounts: {
        supplyAmount: 0,
        vatIn: 0,
        vatOut: 0,
        depositAmount: 0,
        expenseAmount: 300000,
        bankAmount: 300000,
      },
    });
    const weekA = makeWeek();
    const weekB = makeWeek({
      id: 'project-2-2026-03-w1',
      projectId: 'project-2',
      projection: { SALES_IN: 500000, DIRECT_COST_OUT: 100000 },
      actual: { SALES_IN: 450000, DIRECT_COST_OUT: 120000 },
      updatedAt: '2026-03-05T00:00:00.000Z',
    });

    const { rows, summary, lineRows } = buildDashboardCashflowRollups({
      projects: [projectA, projectB],
      transactions: [txIn, txOut],
      cashflowWeeks: [weekA, weekB],
      yearMonth: '2026-03',
    });

    expect(summary.totalApprovedIn).toBe(1000000);
    expect(summary.totalApprovedOut).toBe(300000);
    expect(summary.totalApprovedNet).toBe(700000);
    expect(summary.totalCurrentMonthProjectionNet).toBe(1000000);
    expect(summary.totalCurrentMonthActualNet).toBe(780000);
    expect(summary.totalCurrentMonthVarianceNet).toBe(-220000);

    expect(rows[0]?.projectId).toBe('project-2');
    const firstProject = rows.find((row) => row.projectId === 'project-1');
    expect(firstProject?.approvedNet).toBe(700000);
    expect(firstProject?.currentMonthProjectionNet).toBe(600000);
    expect(firstProject?.currentMonthActualNet).toBe(450000);

    const salesIn = lineRows.find((row) => row.lineId === 'SALES_IN');
    expect(salesIn?.currentMonthProjectionAmount).toBe(1300000);
    expect(salesIn?.currentMonthActualAmount).toBe(1150000);

    const directCostOut = lineRows.find((row) => row.lineId === 'DIRECT_COST_OUT');
    expect(directCostOut?.currentMonthProjectionAmount).toBe(300000);
    expect(directCostOut?.currentMonthActualAmount).toBe(370000);
  });
});
