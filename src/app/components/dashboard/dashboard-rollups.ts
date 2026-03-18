import type { CashflowSheetLineId, CashflowWeekSheet, Project, Transaction } from '../../data/types';
import { CASHFLOW_SHEET_LINE_LABELS } from '../../data/types';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES, computeCashflowTotals } from '../../platform/cashflow-sheet';

export function toFiniteNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function toSafeString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

export function compareSafeLocaleAsc(a: unknown, b: unknown): number {
  return toSafeString(a).localeCompare(toSafeString(b));
}

export function compareSafeLocaleDesc(a: unknown, b: unknown): number {
  return toSafeString(b).localeCompare(toSafeString(a));
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function pickLaterIso(a?: string, b?: string): string | undefined {
  return toTimestamp(a) >= toTimestamp(b) ? a : b;
}

export interface DashboardProjectCashflowRollup {
  projectId: string;
  projectName: string;
  department: string;
  contractAmount: number;
  approvedIn: number;
  approvedOut: number;
  approvedNet: number;
  cumulativeProjectionNet: number;
  cumulativeActualNet: number;
  currentMonthProjectionNet: number;
  currentMonthActualNet: number;
  currentMonthVarianceNet: number;
  weekCount: number;
  transactionCount: number;
  lastUpdatedAt?: string;
}

export interface DashboardCashflowSummary {
  totalApprovedIn: number;
  totalApprovedOut: number;
  totalApprovedNet: number;
  totalCumulativeProjectionNet: number;
  totalCumulativeActualNet: number;
  totalCurrentMonthProjectionNet: number;
  totalCurrentMonthActualNet: number;
  totalCurrentMonthVarianceNet: number;
  activeProjectCount: number;
  varianceProjectCount: number;
}

export interface DashboardCashflowLineRollup {
  lineId: CashflowSheetLineId;
  label: string;
  direction: 'IN' | 'OUT';
  currentMonthProjectionAmount: number;
  currentMonthActualAmount: number;
  currentMonthVarianceAmount: number;
  cumulativeProjectionAmount: number;
  cumulativeActualAmount: number;
}

export function buildDashboardCashflowRollups(input: {
  projects: Project[];
  transactions: Transaction[];
  cashflowWeeks: CashflowWeekSheet[];
  yearMonth: string;
}): {
  rows: DashboardProjectCashflowRollup[];
  summary: DashboardCashflowSummary;
  lineRows: DashboardCashflowLineRollup[];
} {
  const rowMap = new Map<string, DashboardProjectCashflowRollup>();
  const projectMap = new Map(input.projects.map((project) => [project.id, project]));
  const lineMap = new Map<CashflowSheetLineId, DashboardCashflowLineRollup>(
    CASHFLOW_ALL_LINES.map((lineId) => [
      lineId,
      {
        lineId,
        label: CASHFLOW_SHEET_LINE_LABELS[lineId],
        direction: CASHFLOW_IN_LINES.includes(lineId) ? 'IN' : 'OUT',
        currentMonthProjectionAmount: 0,
        currentMonthActualAmount: 0,
        currentMonthVarianceAmount: 0,
        cumulativeProjectionAmount: 0,
        cumulativeActualAmount: 0,
      },
    ]),
  );

  const ensureRow = (projectId: string): DashboardProjectCashflowRollup => {
    const current = rowMap.get(projectId);
    if (current) return current;
    const project = projectMap.get(projectId);
    const next: DashboardProjectCashflowRollup = {
      projectId,
      projectName: project?.name || projectId,
      department: project?.department || '미지정',
      contractAmount: toFiniteNumber(project?.contractAmount),
      approvedIn: 0,
      approvedOut: 0,
      approvedNet: 0,
      cumulativeProjectionNet: 0,
      cumulativeActualNet: 0,
      currentMonthProjectionNet: 0,
      currentMonthActualNet: 0,
      currentMonthVarianceNet: 0,
      weekCount: 0,
      transactionCount: 0,
      lastUpdatedAt: project?.updatedAt,
    };
    rowMap.set(projectId, next);
    return next;
  };

  for (const project of input.projects) {
    ensureRow(project.id);
  }

  for (const tx of input.transactions) {
    if (tx.state !== 'APPROVED') continue;
    const row = ensureRow(tx.projectId);
    const amount = toFiniteNumber(tx.amounts?.bankAmount);
    if (tx.direction === 'IN') row.approvedIn += amount;
    else row.approvedOut += amount;
    row.approvedNet = row.approvedIn - row.approvedOut;
    row.transactionCount += 1;
    row.lastUpdatedAt = pickLaterIso(row.lastUpdatedAt, tx.updatedAt || tx.dateTime);
  }

  for (const week of input.cashflowWeeks) {
    const row = ensureRow(week.projectId);
    const projection = computeCashflowTotals(week.projection);
    const actual = computeCashflowTotals(week.actual);
    row.cumulativeProjectionNet += projection.net;
    row.cumulativeActualNet += actual.net;
    if (week.yearMonth === input.yearMonth) {
      row.currentMonthProjectionNet += projection.net;
      row.currentMonthActualNet += actual.net;
    }
    row.weekCount += 1;
    row.lastUpdatedAt = pickLaterIso(row.lastUpdatedAt, week.updatedAt || week.weekEnd);

    for (const lineId of CASHFLOW_ALL_LINES) {
      const line = lineMap.get(lineId);
      if (!line) continue;
      const projectionAmount = toFiniteNumber(week.projection?.[lineId]);
      const actualAmount = toFiniteNumber(week.actual?.[lineId]);
      line.cumulativeProjectionAmount += projectionAmount;
      line.cumulativeActualAmount += actualAmount;
      if (week.yearMonth === input.yearMonth) {
        line.currentMonthProjectionAmount += projectionAmount;
        line.currentMonthActualAmount += actualAmount;
      }
    }
  }

  const rows = Array.from(rowMap.values())
    .map((row) => ({
      ...row,
      currentMonthVarianceNet: row.currentMonthActualNet - row.currentMonthProjectionNet,
    }))
    .sort((a, b) => {
      const scoreA = Math.max(
        Math.abs(a.approvedNet),
        Math.abs(a.currentMonthActualNet),
        Math.abs(a.currentMonthProjectionNet),
        Math.abs(a.contractAmount),
      );
      const scoreB = Math.max(
        Math.abs(b.approvedNet),
        Math.abs(b.currentMonthActualNet),
        Math.abs(b.currentMonthProjectionNet),
        Math.abs(b.contractAmount),
      );
      if (scoreA !== scoreB) return scoreB - scoreA;
      return toTimestamp(b.lastUpdatedAt) - toTimestamp(a.lastUpdatedAt);
    });

  const summary = rows.reduce<DashboardCashflowSummary>((acc, row) => {
    acc.totalApprovedIn += row.approvedIn;
    acc.totalApprovedOut += row.approvedOut;
    acc.totalApprovedNet += row.approvedNet;
    acc.totalCumulativeProjectionNet += row.cumulativeProjectionNet;
    acc.totalCumulativeActualNet += row.cumulativeActualNet;
    acc.totalCurrentMonthProjectionNet += row.currentMonthProjectionNet;
    acc.totalCurrentMonthActualNet += row.currentMonthActualNet;
    acc.totalCurrentMonthVarianceNet += row.currentMonthVarianceNet;
    if (
      row.approvedIn !== 0 ||
      row.approvedOut !== 0 ||
      row.cumulativeProjectionNet !== 0 ||
      row.cumulativeActualNet !== 0
    ) {
      acc.activeProjectCount += 1;
    }
    if (row.currentMonthVarianceNet !== 0) {
      acc.varianceProjectCount += 1;
    }
    return acc;
  }, {
    totalApprovedIn: 0,
    totalApprovedOut: 0,
    totalApprovedNet: 0,
    totalCumulativeProjectionNet: 0,
    totalCumulativeActualNet: 0,
    totalCurrentMonthProjectionNet: 0,
    totalCurrentMonthActualNet: 0,
    totalCurrentMonthVarianceNet: 0,
    activeProjectCount: 0,
    varianceProjectCount: 0,
  });

  const lineRows = CASHFLOW_ALL_LINES.map((lineId) => {
    const line = lineMap.get(lineId)!;
    return {
      ...line,
      currentMonthVarianceAmount: line.currentMonthActualAmount - line.currentMonthProjectionAmount,
    };
  });

  return { rows, summary, lineRows };
}
