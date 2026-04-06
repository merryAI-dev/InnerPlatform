import { addDays } from './business-days';
import type { PayrollRun, PayrollPaidStatus, Project, Transaction } from '../data/types';

export type PayrollLiquidityStatus =
  | 'insufficient_balance'
  | 'payment_unconfirmed'
  | 'baseline_missing'
  | 'balance_unknown'
  | 'clear';

export interface PayrollLiquidityDayBalance {
  date: string;
  balance: number | null;
}

export interface PayrollLiquidityQueueItem {
  projectId: string;
  projectName: string;
  projectShortName: string;
  runId: string;
  yearMonth: string;
  plannedPayDate: string;
  windowStart: string;
  windowEnd: string;
  expectedPayrollAmount: number | null;
  baselineRunId: string | null;
  status: PayrollLiquidityStatus;
  statusReason: string;
  dayBalances: PayrollLiquidityDayBalance[];
  worstBalance: number | null;
  currentBalance: number | null;
  paidStatus: PayrollPaidStatus;
  acknowledged: boolean;
}

interface ResolvePayrollLiquidityInput {
  projects: Project[];
  runs: PayrollRun[];
  transactions: Transaction[];
  today: string;
}

interface ResolveProjectPayrollLiquidityInput {
  project: Project;
  runs: PayrollRun[];
  transactions: Transaction[];
  today: string;
}

const STATUS_PRIORITY: Record<PayrollLiquidityStatus, number> = {
  insufficient_balance: 0,
  payment_unconfirmed: 1,
  baseline_missing: 2,
  balance_unknown: 3,
  clear: 4,
};

function txAmount(tx: Transaction): number {
  const expense = Number.isFinite(tx.amounts?.expenseAmount) ? tx.amounts.expenseAmount : 0;
  const bank = Number.isFinite(tx.amounts?.bankAmount) ? tx.amounts.bankAmount : 0;
  return Math.max(expense, bank, 0);
}

function toIsoDay(value: string): string {
  return value.slice(0, 10);
}

function isApprovedProjectTransaction(tx: Transaction, projectId: string): boolean {
  return tx.projectId === projectId
    && tx.state === 'APPROVED'
    && typeof tx.amounts?.balanceAfter === 'number';
}

function buildDayWindow(plannedPayDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(plannedPayDate, index - 3));
}

function findLatestBalanceOnOrBefore(transactions: Transaction[], day: string): number | null {
  let latest: Transaction | null = null;
  for (const tx of transactions) {
    const txDay = toIsoDay(tx.dateTime);
    if (txDay > day) continue;
    if (!latest || tx.dateTime > latest.dateTime) latest = tx;
  }
  return latest ? latest.amounts.balanceAfter : null;
}

function findBaselineRun(projectRuns: PayrollRun[], activeRun: PayrollRun): PayrollRun | null {
  const confirmed = projectRuns
    .filter((run) => run.id !== activeRun.id && run.paidStatus === 'CONFIRMED' && run.plannedPayDate < activeRun.plannedPayDate)
    .sort((a, b) => b.plannedPayDate.localeCompare(a.plannedPayDate));
  return confirmed[0] || null;
}

function computeExpectedPayrollAmount(baselineRun: PayrollRun | null, transactions: Transaction[]): number | null {
  if (!baselineRun?.matchedTxIds?.length) return null;
  const matchedIds = new Set(baselineRun.matchedTxIds);
  const amount = transactions
    .filter((tx) => matchedIds.has(tx.id))
    .reduce((sum, tx) => sum + txAmount(tx), 0);
  return amount > 0 ? amount : null;
}

function resolveStatus(args: {
  today: string;
  activeRun: PayrollRun;
  expectedPayrollAmount: number | null;
  dayBalances: PayrollLiquidityDayBalance[];
}): Pick<PayrollLiquidityQueueItem, 'status' | 'statusReason' | 'worstBalance' | 'currentBalance'> {
  const { today, activeRun, expectedPayrollAmount, dayBalances } = args;
  const knownBalances = dayBalances
    .map((entry) => entry.balance)
    .filter((value): value is number => typeof value === 'number');
  const currentBalance = findBalanceForDay(dayBalances, today);
  const worstBalance = knownBalances.length ? Math.min(...knownBalances) : null;
  const insufficient = expectedPayrollAmount !== null
    && knownBalances.some((balance) => balance < expectedPayrollAmount);
  const paymentUnconfirmed = today >= activeRun.plannedPayDate && activeRun.paidStatus !== 'CONFIRMED';

  if (insufficient) {
    return {
      status: 'insufficient_balance',
      statusReason: 'D-3~D+3 구간에 예상 인건비보다 잔액이 낮습니다.',
      worstBalance,
      currentBalance,
    };
  }
  if (paymentUnconfirmed) {
    return {
      status: 'payment_unconfirmed',
      statusReason: '지급일이 지났지만 아직 지급 확정이 기록되지 않았습니다.',
      worstBalance,
      currentBalance,
    };
  }
  if (expectedPayrollAmount === null) {
    return {
      status: 'baseline_missing',
      statusReason: '직전 확정 지급액이 없어 예상 인건비 기준선을 만들 수 없습니다.',
      worstBalance,
      currentBalance,
    };
  }
  if (knownBalances.length === 0) {
    return {
      status: 'balance_unknown',
      statusReason: '잔액 데이터가 없어 지급 여력을 계산할 수 없습니다.',
      worstBalance,
      currentBalance,
    };
  }
  return {
    status: 'clear',
    statusReason: '지급 창에서 잔액과 지급 상태가 안정적입니다.',
    worstBalance,
    currentBalance,
  };
}

function findBalanceForDay(dayBalances: PayrollLiquidityDayBalance[], today: string): number | null {
  const sameDay = dayBalances.find((entry) => entry.date === today);
  if (sameDay) return sameDay.balance;
  const eligible = dayBalances
    .filter((entry) => entry.date <= today && typeof entry.balance === 'number')
    .sort((a, b) => b.date.localeCompare(a.date));
  return eligible[0]?.balance ?? null;
}

export function isPayrollLiquidityRiskStatus(status: PayrollLiquidityStatus): boolean {
  return status === 'insufficient_balance' || status === 'payment_unconfirmed';
}

export function resolveProjectPayrollLiquidity({
  project,
  runs,
  transactions,
  today,
}: ResolveProjectPayrollLiquidityInput): PayrollLiquidityQueueItem[] {
  const projectRuns = runs
    .filter((run) => run.projectId === project.id)
    .sort((a, b) => a.plannedPayDate.localeCompare(b.plannedPayDate));
  const activeRuns = projectRuns.filter((run) => {
    const windowStart = addDays(run.plannedPayDate, -3);
    const windowEnd = addDays(run.plannedPayDate, 3);
    return today >= windowStart && today <= windowEnd;
  });
  const approvedTransactions = transactions
    .filter((tx) => isApprovedProjectTransaction(tx, project.id))
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  return activeRuns
    .map((activeRun) => {
      const baselineRun = findBaselineRun(projectRuns, activeRun);
      const expectedPayrollAmount = computeExpectedPayrollAmount(baselineRun, approvedTransactions);
      const dayBalances = buildDayWindow(activeRun.plannedPayDate).map((day) => ({
        date: day,
        balance: findLatestBalanceOnOrBefore(approvedTransactions, day),
      }));
      const { status, statusReason, worstBalance, currentBalance } = resolveStatus({
        today,
        activeRun,
        expectedPayrollAmount,
        dayBalances,
      });
      return {
        projectId: project.id,
        projectName: project.name,
        projectShortName: project.shortName || project.id,
        runId: activeRun.id,
        yearMonth: activeRun.yearMonth,
        plannedPayDate: activeRun.plannedPayDate,
        windowStart: dayBalances[0]?.date || addDays(activeRun.plannedPayDate, -3),
        windowEnd: dayBalances[dayBalances.length - 1]?.date || addDays(activeRun.plannedPayDate, 3),
        expectedPayrollAmount,
        baselineRunId: baselineRun?.id || null,
        status,
        statusReason,
        dayBalances,
        worstBalance,
        currentBalance,
        paidStatus: activeRun.paidStatus,
        acknowledged: activeRun.acknowledged,
      } satisfies PayrollLiquidityQueueItem;
    })
    .sort((a, b) => {
      const priorityDelta = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (priorityDelta !== 0) return priorityDelta;
      return a.plannedPayDate.localeCompare(b.plannedPayDate);
    });
}

export function resolvePayrollLiquidityQueue({
  projects,
  runs,
  transactions,
  today,
}: ResolvePayrollLiquidityInput): PayrollLiquidityQueueItem[] {
  return projects
    .flatMap((project) => resolveProjectPayrollLiquidity({ project, runs, transactions, today }))
    .sort((a, b) => {
      const priorityDelta = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (priorityDelta !== 0) return priorityDelta;
      if (a.plannedPayDate !== b.plannedPayDate) return a.plannedPayDate.localeCompare(b.plannedPayDate);
      return a.projectName.localeCompare(b.projectName, 'ko');
    });
}
