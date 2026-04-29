import {
  CASHFLOW_CATEGORY_LABELS,
  PROJECT_TYPE_SHORT_LABELS,
  type CashflowCategory,
  type Direction,
  type Project,
  type ProjectType,
  type Transaction,
  type TransactionState,
} from '../data/types';

export type CashflowAnalyticsFilters = {
  projectId?: string;
  projectType?: ProjectType;
  department?: string;
  startDate?: string;
  endDate?: string;
  direction?: Direction;
  state?: TransactionState;
  cashflowCategory?: CashflowCategory;
};

export type CashflowAnalyticsTotals = {
  totalIn: number;
  totalOut: number;
  net: number;
  depositAmount: number;
  expenseAmount: number;
  inputVat: number;
  outputVat: number;
  vatRefund: number;
  withholdingBalance: number;
  count: number;
  approved: number;
};

export type CashflowAnalyticsCategoryRow = {
  category: CashflowCategory;
  label: string;
  inAmt: number;
  outAmt: number;
  net: number;
  depositAmount: number;
  expenseAmount: number;
  inputVat: number;
  outputVat: number;
  vatRefund: number;
  count: number;
};

export type CashflowAnalyticsProjectRow = {
  projectId: string;
  name: string;
  type: ProjectType | '';
  typeLabel: string;
  department: string;
  totalIn: number;
  totalOut: number;
  net: number;
  depositAmount: number;
  expenseAmount: number;
  inputVat: number;
  outputVat: number;
  vatRefund: number;
  withholdingBalance: number;
  count: number;
};

export type CashflowAnalyticsMonthRow = {
  month: string;
  in: number;
  out: number;
  net: number;
};

export type CashflowAnalyticsTransactionRow = Transaction & {
  projectName: string;
  projectDepartment: string;
  projectTypeLabel: string;
};

export type CashflowAnalyticsResult = {
  transactions: CashflowAnalyticsTransactionRow[];
  totals: CashflowAnalyticsTotals;
  monthlyRows: CashflowAnalyticsMonthRow[];
  categoryRows: CashflowAnalyticsCategoryRow[];
  projectRows: CashflowAnalyticsProjectRow[];
};

const EMPTY_TOTALS: CashflowAnalyticsTotals = {
  totalIn: 0,
  totalOut: 0,
  net: 0,
  depositAmount: 0,
  expenseAmount: 0,
  inputVat: 0,
  outputVat: 0,
  vatRefund: 0,
  withholdingBalance: 0,
  count: 0,
  approved: 0,
};

function isAll(value: unknown): boolean {
  return !value || value === 'ALL';
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function projectMatches(project: Project | undefined, filters: CashflowAnalyticsFilters): boolean {
  if (!isAll(filters.projectId)) return true;
  if (!project) return isAll(filters.projectType) && isAll(filters.department);
  if (!isAll(filters.projectType) && project.type !== filters.projectType) return false;
  if (!isAll(filters.department) && project.department !== filters.department) return false;
  return true;
}

export function filterCashflowTransactions({
  transactions,
  projects,
  filters,
}: {
  transactions: Transaction[];
  projects: Project[];
  filters: CashflowAnalyticsFilters;
}): CashflowAnalyticsTransactionRow[] {
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  return transactions
    .filter((transaction) => {
      const project = projectMap.get(transaction.projectId);
      const txDate = dateOnly(transaction.dateTime);

      if (!isAll(filters.projectId) && transaction.projectId !== filters.projectId) return false;
      if (!projectMatches(project, filters)) return false;
      if (filters.startDate && txDate < filters.startDate) return false;
      if (filters.endDate && txDate > filters.endDate) return false;
      if (!isAll(filters.direction) && transaction.direction !== filters.direction) return false;
      if (!isAll(filters.state) && transaction.state !== filters.state) return false;
      if (!isAll(filters.cashflowCategory) && transaction.cashflowCategory !== filters.cashflowCategory) return false;
      return true;
    })
    .map((transaction) => {
      const project = projectMap.get(transaction.projectId);
      return {
        ...transaction,
        projectName: project?.name || '미지정 사업',
        projectDepartment: project?.department || '-',
        projectTypeLabel: project ? PROJECT_TYPE_SHORT_LABELS[project.type] : '-',
      };
    })
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime));
}

function addTransactionToTotals(totals: CashflowAnalyticsTotals, transaction: Transaction): CashflowAnalyticsTotals {
  const totalIn = totals.totalIn + (transaction.direction === 'IN' ? transaction.amounts.bankAmount : 0);
  const totalOut = totals.totalOut + (transaction.direction === 'OUT' ? transaction.amounts.bankAmount : 0);
  const outputVat = totals.outputVat + transaction.amounts.vatOut;
  const inputVat = totals.inputVat + transaction.amounts.vatIn;
  const vatRefund = totals.vatRefund + transaction.amounts.vatRefund;

  return {
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    depositAmount: totals.depositAmount + transaction.amounts.depositAmount,
    expenseAmount: totals.expenseAmount + transaction.amounts.expenseAmount,
    inputVat,
    outputVat,
    vatRefund,
    withholdingBalance: outputVat - inputVat - vatRefund,
    count: totals.count + 1,
    approved: totals.approved + (transaction.state === 'APPROVED' ? 1 : 0),
  };
}

export function summarizeCashflowTransactions(transactions: Transaction[]): CashflowAnalyticsTotals {
  return transactions.reduce(addTransactionToTotals, EMPTY_TOTALS);
}

export function buildCashflowAnalytics({
  transactions,
  projects,
  filters,
}: {
  transactions: Transaction[];
  projects: Project[];
  filters: CashflowAnalyticsFilters;
}): CashflowAnalyticsResult {
  const filteredTransactions = filterCashflowTransactions({ transactions, projects, filters });
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const totals = summarizeCashflowTransactions(filteredTransactions);

  const monthMap = new Map<string, CashflowAnalyticsMonthRow>();
  const categoryMap = new Map<CashflowCategory, CashflowAnalyticsCategoryRow>();
  const projectRowMap = new Map<string, CashflowAnalyticsProjectRow>();

  for (const transaction of filteredTransactions) {
    const month = transaction.dateTime.slice(0, 7);
    const monthRow = monthMap.get(month) || { month, in: 0, out: 0, net: 0 };
    if (transaction.direction === 'IN') monthRow.in += transaction.amounts.bankAmount;
    else monthRow.out += transaction.amounts.bankAmount;
    monthRow.net = monthRow.in - monthRow.out;
    monthMap.set(month, monthRow);

    const categoryRow = categoryMap.get(transaction.cashflowCategory) || {
      category: transaction.cashflowCategory,
      label: CASHFLOW_CATEGORY_LABELS[transaction.cashflowCategory],
      inAmt: 0,
      outAmt: 0,
      net: 0,
      depositAmount: 0,
      expenseAmount: 0,
      inputVat: 0,
      outputVat: 0,
      vatRefund: 0,
      count: 0,
    };
    if (transaction.direction === 'IN') categoryRow.inAmt += transaction.amounts.bankAmount;
    else categoryRow.outAmt += transaction.amounts.bankAmount;
    categoryRow.net = categoryRow.inAmt - categoryRow.outAmt;
    categoryRow.depositAmount += transaction.amounts.depositAmount;
    categoryRow.expenseAmount += transaction.amounts.expenseAmount;
    categoryRow.inputVat += transaction.amounts.vatIn;
    categoryRow.outputVat += transaction.amounts.vatOut;
    categoryRow.vatRefund += transaction.amounts.vatRefund;
    categoryRow.count += 1;
    categoryMap.set(transaction.cashflowCategory, categoryRow);

    const project = projectMap.get(transaction.projectId);
    const projectRow = projectRowMap.get(transaction.projectId) || {
      projectId: transaction.projectId,
      name: project?.name || '미지정 사업',
      type: project?.type || '',
      typeLabel: project ? PROJECT_TYPE_SHORT_LABELS[project.type] : '-',
      department: project?.department || '-',
      totalIn: 0,
      totalOut: 0,
      net: 0,
      depositAmount: 0,
      expenseAmount: 0,
      inputVat: 0,
      outputVat: 0,
      vatRefund: 0,
      withholdingBalance: 0,
      count: 0,
    };
    if (transaction.direction === 'IN') projectRow.totalIn += transaction.amounts.bankAmount;
    else projectRow.totalOut += transaction.amounts.bankAmount;
    projectRow.net = projectRow.totalIn - projectRow.totalOut;
    projectRow.depositAmount += transaction.amounts.depositAmount;
    projectRow.expenseAmount += transaction.amounts.expenseAmount;
    projectRow.inputVat += transaction.amounts.vatIn;
    projectRow.outputVat += transaction.amounts.vatOut;
    projectRow.vatRefund += transaction.amounts.vatRefund;
    projectRow.withholdingBalance = projectRow.outputVat - projectRow.inputVat - projectRow.vatRefund;
    projectRow.count += 1;
    projectRowMap.set(transaction.projectId, projectRow);
  }

  return {
    transactions: filteredTransactions,
    totals,
    monthlyRows: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    categoryRows: [...categoryMap.values()].sort((a, b) => (b.inAmt + b.outAmt) - (a.inAmt + a.outAmt)),
    projectRows: [...projectRowMap.values()].sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut)),
  };
}
