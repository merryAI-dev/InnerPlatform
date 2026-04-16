import { describe, expect, it } from 'vitest';
import type { PayrollRun, Project, Transaction } from '../data/types';
import {
  resolvePayrollReviewQueue,
  resolvePayrollRunReview,
} from './payroll-review';

function createProject(id: string, name = `${id} 사업`): Project {
  return {
    id,
    slug: id,
    orgId: 'org-1',
    shortName: id,
    name,
    clientOrg: '',
    groupwareName: '',
    department: 'AC',
    type: 'A1',
    phase: 'CONFIRMED',
    status: 'IN_PROGRESS',
    contractAmount: 0,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'TYPE1',
    basis: '공급가액',
    accountType: 'OPERATING',
    paymentPlan: {
      contract: 0,
      interim: 0,
      final: 0,
    },
    paymentPlanDesc: '',
    projectPurpose: '',
    participantCondition: '',
    contractType: '',
    salesVatAmount: 0,
    totalRevenueAmount: 0,
    supportAmount: 0,
    settlementGuide: '',
    contractDocument: null,
    teamName: '',
    managerId: 'user-1',
    managerName: '',
    budgetCurrentYear: 0,
    taxInvoiceAmount: 0,
    profitRate: 0,
    profitAmount: 0,
    isSettled: false,
    finalPaymentNote: '',
    confirmerName: '',
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    cashflowDiffNote: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createRun(input: Record<string, unknown> & Pick<PayrollRun, 'id' | 'projectId' | 'yearMonth' | 'plannedPayDate'>): PayrollRun {
  return {
    id: input.id,
    tenantId: 'org-1',
    projectId: input.projectId,
    yearMonth: input.yearMonth,
    plannedPayDate: input.plannedPayDate,
    noticeDate: '2026-04-22',
    noticeLeadBusinessDays: 3,
    acknowledged: false,
    paidStatus: 'UNKNOWN',
    matchedTxIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(input as any),
  };
}

function createTransaction(input: Partial<Transaction> & Pick<Transaction, 'id' | 'projectId' | 'dateTime' | 'amounts'>): Transaction {
  return {
    ledgerId: 'ledger-1',
    state: 'APPROVED',
    weekCode: '2026-W17',
    direction: 'OUT',
    method: 'TRANSFER',
    cashflowCategory: 'MISC_EXPENSE',
    cashflowLabel: '기타지출',
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

describe('payroll-review', () => {
  it('detects only payroll-like approved outbound transactions inside the payroll review window', () => {
    const run = createRun({
      id: 'run-1',
      projectId: 'p-1',
      yearMonth: '2026-04',
      plannedPayDate: '2026-04-27',
    });

    const review = resolvePayrollRunReview({
      run,
      transactions: [
        createTransaction({
          id: 'tx-payroll-category',
          projectId: 'p-1',
          dateTime: '2026-04-24',
          cashflowCategory: 'LABOR_COST',
          cashflowLabel: '인건비',
          memo: '4월 급여 지급',
          counterparty: 'MYSC Payroll',
          amounts: { bankAmount: 3200000, depositAmount: 0, expenseAmount: 3200000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 7000000 },
        }),
        createTransaction({
          id: 'tx-memo-hit',
          projectId: 'p-1',
          dateTime: '2026-04-23',
          memo: '급여 보전',
          counterparty: '보람',
          amounts: { bankAmount: 1200000, depositAmount: 0, expenseAmount: 1200000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 8200000 },
        }),
        createTransaction({
          id: 'tx-non-payroll',
          projectId: 'p-1',
          dateTime: '2026-04-23',
          memo: '회의비 정산',
          counterparty: '카페',
          amounts: { bankAmount: 12000, depositAmount: 0, expenseAmount: 12000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 8300000 },
        }),
        createTransaction({
          id: 'tx-outside-window',
          projectId: 'p-1',
          dateTime: '2026-05-06',
          cashflowCategory: 'LABOR_COST',
          cashflowLabel: '인건비',
          memo: '5월 급여 지급',
          amounts: { bankAmount: 3000000, depositAmount: 0, expenseAmount: 3000000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 4000000 },
        }),
        createTransaction({
          id: 'tx-submitted',
          projectId: 'p-1',
          dateTime: '2026-04-24',
          state: 'SUBMITTED',
          cashflowCategory: 'LABOR_COST',
          cashflowLabel: '인건비',
          memo: '4월 급여 초안',
          amounts: { bankAmount: 3000000, depositAmount: 0, expenseAmount: 3000000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 4000000 },
        }),
      ],
      today: '2026-04-24',
    });

    expect(review.windowStart).toBe('2026-04-22');
    expect(review.windowEnd).toBe('2026-04-30');
    expect(review.reviewCandidates.map((candidate) => candidate.txId)).toEqual([
      'tx-memo-hit',
      'tx-payroll-category',
    ]);
    expect(review.reviewCandidates[1]?.signals).toContain('cashflow:LABOR_COST');
    expect(review.reviewCandidates[0]?.signals).toContain('memo:급여');
    expect(review.pmReviewStatus).toBe('PENDING');
    expect(review.paidStatus).toBe('AUTO_MATCHED');
    expect(review.needsPmReview).toBe(true);
    expect(review.hasMissingCandidate).toBe(false);
  });

  it('requires final PM decisions before admin can confirm payroll', () => {
    const run = createRun({
      id: 'run-1',
      projectId: 'p-1',
      yearMonth: '2026-04',
      plannedPayDate: '2026-04-27',
      reviewCandidates: [
        {
          txId: 'tx-payroll',
          detectedFrom: 'rule_engine',
          signals: ['cashflow:LABOR_COST'],
          decision: 'PAYROLL',
        },
        {
          txId: 'tx-hold',
          detectedFrom: 'rule_engine',
          signals: ['memo:급여'],
          decision: 'HOLD',
        },
      ],
    });

    const pendingReview = resolvePayrollRunReview({
      run,
      transactions: [
        createTransaction({
          id: 'tx-payroll',
          projectId: 'p-1',
          dateTime: '2026-04-24',
          cashflowCategory: 'LABOR_COST',
          cashflowLabel: '인건비',
          memo: '4월 급여 지급',
          amounts: { bankAmount: 3200000, depositAmount: 0, expenseAmount: 3200000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 7000000 },
        }),
        createTransaction({
          id: 'tx-hold',
          projectId: 'p-1',
          dateTime: '2026-04-24',
          memo: '급여?',
          amounts: { bankAmount: 400000, depositAmount: 0, expenseAmount: 400000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 6600000 },
        }),
      ],
      today: '2026-04-24',
    });

    expect(pendingReview.pmReviewStatus).toBe('PENDING');
    expect(pendingReview.pendingDecisionCount).toBe(1);
    expect(pendingReview.payrollDecisionCount).toBe(1);
    expect(pendingReview.canAdminConfirm).toBe(false);

    const completedReview = resolvePayrollRunReview({
      run: createRun({
        id: 'run-1',
        projectId: 'p-1',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-27',
        reviewCandidates: [
          {
            txId: 'tx-payroll',
            detectedFrom: 'rule_engine',
            signals: ['cashflow:LABOR_COST'],
            decision: 'PAYROLL',
          },
          {
            txId: 'tx-hold',
            detectedFrom: 'rule_engine',
            signals: ['memo:급여'],
            decision: 'NOT_PAYROLL',
          },
        ],
      }),
      transactions: [
        createTransaction({
          id: 'tx-payroll',
          projectId: 'p-1',
          dateTime: '2026-04-24',
          cashflowCategory: 'LABOR_COST',
          cashflowLabel: '인건비',
          memo: '4월 급여 지급',
          amounts: { bankAmount: 3200000, depositAmount: 0, expenseAmount: 3200000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 7000000 },
        }),
        createTransaction({
          id: 'tx-hold',
          projectId: 'p-1',
          dateTime: '2026-04-24',
          memo: '급여?',
          amounts: { bankAmount: 400000, depositAmount: 0, expenseAmount: 400000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 6600000 },
        }),
      ],
      today: '2026-04-24',
    });

    expect(completedReview.pmReviewStatus).toBe('COMPLETED');
    expect(completedReview.pendingDecisionCount).toBe(0);
    expect(completedReview.payrollDecisionCount).toBe(1);
    expect(completedReview.canAdminConfirm).toBe(true);
    expect(completedReview.paidStatus).toBe('AUTO_MATCHED');
  });

  it('marks an active payroll window without candidates as missing instead of success', () => {
    const review = resolvePayrollRunReview({
      run: createRun({
        id: 'run-1',
        projectId: 'p-1',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-27',
      }),
      transactions: [],
      today: '2026-04-24',
    });

    expect(review.pmReviewStatus).toBe('MISSING_CANDIDATE');
    expect(review.hasMissingCandidate).toBe(true);
    expect(review.missingCandidateAlertAt).toBe('2026-04-24');
    expect(review.paidStatus).toBe('MISSING');
    expect(review.canAdminConfirm).toBe(false);
  });

  it('builds a queue that separates PM review, missing candidates, and admin final confirm', () => {
    const projects = [
      createProject('p-pending'),
      createProject('p-missing'),
      createProject('p-confirmable'),
    ];
    const runs = [
      createRun({
        id: 'run-pending',
        projectId: 'p-pending',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-27',
        reviewCandidates: [
          {
            txId: 'tx-pending',
            detectedFrom: 'rule_engine',
            signals: ['cashflow:LABOR_COST'],
            decision: 'PENDING',
          },
        ],
      }),
      createRun({
        id: 'run-missing',
        projectId: 'p-missing',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-27',
      }),
      createRun({
        id: 'run-confirmable',
        projectId: 'p-confirmable',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-27',
        reviewCandidates: [
          {
            txId: 'tx-confirmable',
            detectedFrom: 'rule_engine',
            signals: ['cashflow:LABOR_COST'],
            decision: 'PAYROLL',
          },
        ],
      }),
    ];
    const transactions = [
      createTransaction({
        id: 'tx-pending',
        projectId: 'p-pending',
        dateTime: '2026-04-24',
        cashflowCategory: 'LABOR_COST',
        cashflowLabel: '인건비',
        memo: '4월 급여 지급',
        amounts: { bankAmount: 3200000, depositAmount: 0, expenseAmount: 3200000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 7000000 },
      }),
      createTransaction({
        id: 'tx-confirmable',
        projectId: 'p-confirmable',
        dateTime: '2026-04-24',
        cashflowCategory: 'LABOR_COST',
        cashflowLabel: '인건비',
        memo: '4월 급여 지급',
        amounts: { bankAmount: 2800000, depositAmount: 0, expenseAmount: 2800000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 7200000 },
      }),
    ];

    const queue = resolvePayrollReviewQueue({
      projects,
      runs,
      transactions,
      today: '2026-04-24',
    });

    expect(queue).toHaveLength(3);
    expect(queue.find((item) => item.projectId === 'p-pending')).toMatchObject({
      needsPmReview: true,
      hasMissingCandidate: false,
      needsAdminConfirm: false,
    });
    expect(queue.find((item) => item.projectId === 'p-missing')).toMatchObject({
      needsPmReview: false,
      hasMissingCandidate: true,
      needsAdminConfirm: false,
    });
    expect(queue.find((item) => item.projectId === 'p-confirmable')).toMatchObject({
      needsPmReview: false,
      hasMissingCandidate: false,
      needsAdminConfirm: true,
    });
  });

  it('ignores persisted review rows that are no longer present in the live transaction set', () => {
    const review = resolvePayrollRunReview({
      run: createRun({
        id: 'run-1',
        projectId: 'p-1',
        yearMonth: '2026-04',
        plannedPayDate: '2026-04-27',
        reviewCandidates: [
          {
            txId: 'tx-stale',
            detectedFrom: 'rule_engine',
            signals: ['memo:급여'],
            decision: 'PAYROLL',
          },
        ],
      }),
      transactions: [],
      today: '2026-04-24',
    });

    expect(review.reviewCandidates).toEqual([]);
    expect(review.pmReviewStatus).toBe('MISSING_CANDIDATE');
    expect(review.canAdminConfirm).toBe(false);
  });
});
