import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import type {
  CashflowMonthCloseCell,
  CashflowMonthCloseConfirmation,
  CashflowMonthCloseDepositScheduleRow,
  CashflowMonthCloseDraftInput,
  CashflowMonthCloseLockRange,
  CashflowManagementCheck,
  CashflowManagementConfirmation,
  CashflowDeadlineSummary,
} from '../../lib/platform-bff-client';
import type {
  CashflowSheetLabMirrorResult,
  CashflowSheetLabYearViewResult,
} from '../../lib/sheets-cashflow-readonly-client';

export type CashflowMonthCloseDecision = CashflowMonthCloseConfirmation['decision'];
export type CashflowMonthCloseDecisionMap = Record<string, CashflowMonthCloseDecision | undefined>;
export type CashflowManagementDecisionMap = Record<string, CashflowManagementConfirmation['decision'] | undefined>;
export type CashflowMonthCloseDepositReviewRow = Omit<CashflowMonthCloseDepositScheduleRow, 'decision'> & {
  decision: CashflowMonthCloseDepositScheduleRow['decision'] | null;
};

export const CASHFLOW_MONTH_CLOSE_WEEK_NOS = [1, 2, 3, 4, 5] as const;

export function isCashflowMonthCloseRequestLocked(status?: string): boolean {
  return status === 'PENDING' || status === 'APPROVING' || status === 'UNCERTAIN';
}

export function isCashflowWeekLockedByRange(
  lockRange: CashflowMonthCloseLockRange | undefined,
  yearMonth: string,
  weekNo: number,
): boolean {
  if (!lockRange) return false;
  const target = `${yearMonth}-w${String(weekNo).padStart(2, '0')}`;
  const start = `${lockRange.fromMonth}-w${String(lockRange.fromWeekNo).padStart(2, '0')}`;
  const end = `${lockRange.throughMonth}-w${String(lockRange.throughWeekNo).padStart(2, '0')}`;
  return target >= start && target <= end;
}

export function shouldApplyCashflowMonthCloseRequestResult(input: {
  requestGeneration: number;
  currentGeneration: number;
  requestedYearMonth: string;
  selectedYearMonth: string;
}): boolean {
  return input.requestGeneration === input.currentGeneration
    && input.requestedYearMonth === input.selectedYearMonth;
}

export type CashflowSheetDashboardMetadata = NonNullable<
  NonNullable<CashflowSheetLabMirrorResult['sheetFacts']>['metadata']
>;

export function resolveCashflowEvidenceScope(input: {
  projectId: string;
  yearMonth: string;
  monthClose: {
    projectId: string;
    yearMonth: string;
    status: string;
    dashboard?: {
      snapshotCompatibility?: { status?: string };
      sheetMetadata?: Record<string, unknown>;
    };
  } | null;
  liveYearView: CashflowSheetLabYearViewResult | null;
  liveSheetMetadata?: CashflowSheetDashboardMetadata;
}): {
  allowLiveAnnualYearView: boolean;
  yearView: CashflowSheetLabYearViewResult | null;
  sheetMetadata?: CashflowSheetDashboardMetadata;
} {
  const sameScope = input.monthClose?.projectId === input.projectId
    && input.monthClose.yearMonth === input.yearMonth;
  const allowLiveAnnualYearView = sameScope
    && input.monthClose?.status === 'OPEN'
    && input.monthClose.dashboard?.snapshotCompatibility?.status !== 'LEGACY_EVIDENCE_ONLY';
  const frozenMetadata = input.monthClose?.dashboard?.sheetMetadata;
  const hasFrozenMetadata = sameScope
    && frozenMetadata != null
    && Object.keys(frozenMetadata).length > 0;
  return {
    allowLiveAnnualYearView,
    yearView: allowLiveAnnualYearView ? input.liveYearView : null,
    sheetMetadata: hasFrozenMetadata
      ? frozenMetadata as CashflowSheetDashboardMetadata
      : allowLiveAnnualYearView
        ? input.liveSheetMetadata
        : undefined,
  };
}

export function carryForwardCashflowRunningBalances(input: {
  priorWeeklyNet: number;
  annualOpeningBalance: number;
  serverRunningNets: Array<number | null>;
}): number[] {
  let carriedWeeklyNet = input.priorWeeklyNet;
  return input.serverRunningNets.map((serverNet) => {
    if (serverNet != null) carriedWeeklyNet = serverNet;
    return carriedWeeklyNet + input.annualOpeningBalance;
  });
}

export function cashflowMonthCloseConfirmationKey(input: {
  mode: CashflowMonthCloseCell['mode'];
  weekNo: number;
  cashflowLine: string;
}): string {
  return `${input.mode}:${input.weekNo}:${input.cashflowLine}`;
}

export function requiredCashflowMonthCloseDecision(
  cell: Pick<CashflowMonthCloseCell, 'cellState'>,
): CashflowMonthCloseDecision {
  return cell.cellState === 'VALUE' || cell.cellState === 'ZERO' ? 'CONFIRMED' : 'NOT_APPLICABLE';
}

export function createEmptyCashflowMonthCloseDepositRows(): CashflowMonthCloseDepositReviewRow[] {
  return CASHFLOW_MONTH_CLOSE_WEEK_NOS.map((weekNo) => ({
    weekNo,
    taxInvoiceIssuedDate: '',
    expectedDepositDate: '',
    expectedDepositAmount: null,
    actualDepositDate: '',
    actualDepositAmount: null,
    actualSource: 'NOT_APPLICABLE',
    decision: null,
  }));
}

function assertPinnedMirror(
  mirror: CashflowSheetLabMirrorResult | null,
  yearMonth: string,
): asserts mirror is CashflowSheetLabMirrorResult & {
  sourceRevision: string;
  targetRevisionAtFetch: string;
  cells: NonNullable<CashflowSheetLabMirrorResult['cells']>;
} {
  if (mirror?.status !== 'FRESH') {
    throw new Error('시트값 불러오기를 실행해 최신 고정본을 준비해 주세요.');
  }
  if (!mirror.sourceRevision || !mirror.targetRevisionAtFetch) {
    throw new Error('시트 고정본의 원본/MYSCube 시트 버전을 확인할 수 없습니다.');
  }
  if (!mirror.yearMonths?.includes(yearMonth)) {
    throw new Error(`${yearMonth} 시트 고정본이 없습니다.`);
  }
  if (!Array.isArray(mirror.cells)) {
    throw new Error('시트 고정본 셀을 확인할 수 없습니다.');
  }
}

export function normalizeCashflowMonthCloseCells(
  mirror: CashflowSheetLabMirrorResult | null,
  yearMonth: string,
): CashflowMonthCloseCell[] {
  assertPinnedMirror(mirror, yearMonth);
  const allowedLines = new Set<string>(CASHFLOW_ALL_LINES);
  const cellsByKey = new Map<string, CashflowMonthCloseCell>();

  for (const source of mirror.cells) {
    if (source.yearMonth !== yearMonth) continue;
    if (!allowedLines.has(source.lineId)) continue;
    if (!CASHFLOW_MONTH_CLOSE_WEEK_NOS.includes(source.weekNo as (typeof CASHFLOW_MONTH_CLOSE_WEEK_NOS)[number])) continue;
    if (source.state === 'INVALID') {
      throw new Error(`${source.sourceCell || source.sourceLabel || '시트 셀'} 값이 올바르지 않습니다.`);
    }
    const key = cashflowMonthCloseConfirmationKey({
      mode: source.mode,
      weekNo: source.weekNo,
      cashflowLine: source.lineId,
    });
    if (cellsByKey.has(key)) throw new Error(`중복된 시트 셀이 있습니다: ${key}`);
    const hasValue = source.state === 'VALUE' || source.state === 'ZERO';
    const amount = hasValue ? Number(source.amount) : null;
    if (hasValue && !Number.isFinite(amount)) {
      throw new Error(`${source.sourceCell || source.sourceLabel || key} 금액을 확인해 주세요.`);
    }
    cellsByKey.set(key, {
      mode: source.mode,
      weekNo: source.weekNo,
      cashflowLine: source.lineId,
      cellState: source.state,
      amount,
      sourceCell: source.sourceCell || null,
      sourceLabel: source.sourceLabel || null,
    });
  }

  const expectedCellCount = 2 * CASHFLOW_MONTH_CLOSE_WEEK_NOS.length * CASHFLOW_ALL_LINES.length;
  if (cellsByKey.size !== expectedCellCount) {
    throw new Error(`결산 대상 셀이 ${cellsByKey.size}/${expectedCellCount}개입니다. 시트 범위와 양식을 확인해 주세요.`);
  }

  return (['projection', 'actual'] as const).flatMap((mode) => (
    CASHFLOW_MONTH_CLOSE_WEEK_NOS.flatMap((weekNo) => (
      CASHFLOW_ALL_LINES.map((cashflowLine) => {
        const key = cashflowMonthCloseConfirmationKey({ mode, weekNo, cashflowLine });
        const cell = cellsByKey.get(key);
        if (!cell) throw new Error(`결산 대상 셀이 누락되었습니다: ${key}`);
        return cell;
      })
    ))
  ));
}

export function applyCashflowMonthCloseProjectionDrafts(
  cells: CashflowMonthCloseCell[],
  drafts: Record<string, string>,
  yearMonth: string,
): CashflowMonthCloseCell[] {
  const prefix = `${yearMonth}:projection:`;
  return cells.map((cell) => {
    if (cell.mode !== 'projection') return cell;
    const key = `${prefix}${cell.weekNo}:${cell.cashflowLine}`;
    if (!Object.prototype.hasOwnProperty.call(drafts, key)) return cell;
    const raw = String(drafts[key] ?? '').trim().replaceAll(',', '');
    if (!raw) return { ...cell, cellState: 'EMPTY', amount: null };
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount)) {
      throw new Error(`${cell.sourceLabel || cell.sourceCell || key} 수정 금액을 확인해 주세요.`);
    }
    return { ...cell, cellState: 'VALUE', amount };
  });
}

function normalizeDepositRows(
  rows: CashflowMonthCloseDepositReviewRow[],
): CashflowMonthCloseDepositScheduleRow[] {
  if (rows.length !== CASHFLOW_MONTH_CLOSE_WEEK_NOS.length) {
    throw new Error('입금 일정은 1~5주차를 모두 확인해야 합니다.');
  }
  const byWeek = new Map(rows.map((row) => [row.weekNo, row]));
  return CASHFLOW_MONTH_CLOSE_WEEK_NOS.map((weekNo) => {
    const row = byWeek.get(weekNo);
    if (!row) throw new Error(`${weekNo}주차 입금 일정이 없습니다.`);
    const hasExpected = Boolean(row.taxInvoiceIssuedDate || row.expectedDepositDate || row.expectedDepositAmount != null);
    const hasActual = Boolean(row.actualDepositDate || row.actualDepositAmount != null);
    if (!hasExpected && !hasActual) {
      if (row.actualSource !== 'NOT_APPLICABLE') {
        throw new Error(`${weekNo}주차 실제 입금값이 없으면 출처도 해당 없음이어야 합니다.`);
      }
      return { ...row, decision: 'NOT_APPLICABLE' };
    }

    if (hasActual && row.actualSource === 'NOT_APPLICABLE') {
      throw new Error(`${weekNo}주차 실제 입금값의 출처를 선택해 주세요.`);
    }
    if (!hasActual && row.actualSource !== 'NOT_APPLICABLE') {
      throw new Error(`${weekNo}주차 실제 입금값이 없으면 출처도 해당 없음이어야 합니다.`);
    }
    return { ...row, decision: 'CONFIRMED' };
  });
}

export function buildCashflowMonthCloseDraftInput(input: {
  mirror: CashflowSheetLabMirrorResult | null;
  yearMonth: string;
  humanReviewed: boolean;
  depositScheduleRows: CashflowMonthCloseDepositReviewRow[];
  projectionDrafts?: Record<string, string>;
  managementChecks: CashflowManagementCheck[];
  deadlineSummary: CashflowDeadlineSummary;
}): CashflowMonthCloseDraftInput {
  if (!input.humanReviewed) {
    throw new Error('시트의 값과 일치하는지 직접 확인해 주세요.');
  }
  const cells = applyCashflowMonthCloseProjectionDrafts(
    normalizeCashflowMonthCloseCells(input.mirror, input.yearMonth),
    input.projectionDrafts || {},
    input.yearMonth,
  );
  const confirmations = cells.map<CashflowMonthCloseConfirmation>((cell) => ({
      mode: cell.mode,
      weekNo: cell.weekNo,
      cashflowLine: cell.cashflowLine,
      decision: requiredCashflowMonthCloseDecision(cell),
    }));

  assertPinnedMirror(input.mirror, input.yearMonth);
  const managementConfirmations: CashflowManagementConfirmation[] = [];
  return {
    sourceRevision: input.mirror.sourceRevision,
    targetRevision: input.mirror.targetRevisionAtFetch,
    yearMonth: input.yearMonth,
    humanReviewed: true,
    depositScheduleRows: normalizeDepositRows(input.depositScheduleRows),
    cells,
    confirmations,
    managementChecks: input.managementChecks,
    managementConfirmations,
    deadlineSummary: input.deadlineSummary,
  };
}

export function readCashflowMonthCloseReview(value: unknown, yearMonth: string): {
  decisions: CashflowMonthCloseDecisionMap;
  depositScheduleRows: CashflowMonthCloseDepositReviewRow[];
  managementDecisions: CashflowManagementDecisionMap;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as {
    yearMonth?: unknown;
    confirmations?: unknown;
    depositScheduleRows?: unknown;
    managementConfirmations?: unknown;
  };
  if (source.yearMonth !== yearMonth || !Array.isArray(source.confirmations) || !Array.isArray(source.depositScheduleRows)) return null;
  const decisions: CashflowMonthCloseDecisionMap = {};
  for (const raw of source.confirmations) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const confirmation = raw as Partial<CashflowMonthCloseConfirmation>;
    if (
      (confirmation.mode === 'projection' || confirmation.mode === 'actual')
      && Number.isInteger(confirmation.weekNo)
      && typeof confirmation.cashflowLine === 'string'
      && (confirmation.decision === 'CONFIRMED' || confirmation.decision === 'NOT_APPLICABLE')
    ) {
      decisions[cashflowMonthCloseConfirmationKey({
        mode: confirmation.mode,
        weekNo: confirmation.weekNo as number,
        cashflowLine: confirmation.cashflowLine,
      })] = confirmation.decision;
    }
  }
  const depositRows = source.depositScheduleRows.filter((row): row is CashflowMonthCloseDepositReviewRow => (
    Boolean(row && typeof row === 'object' && !Array.isArray(row) && Number.isInteger((row as { weekNo?: unknown }).weekNo))
  ));
  if (depositRows.length !== CASHFLOW_MONTH_CLOSE_WEEK_NOS.length) return null;
  const managementDecisions: CashflowManagementDecisionMap = {};
  for (const raw of Array.isArray(source.managementConfirmations) ? source.managementConfirmations : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Partial<CashflowManagementConfirmation>;
    if (typeof item.checkId === 'string' && (item.decision === 'CONFIRMED' || item.decision === 'NOT_APPLICABLE')) {
      managementDecisions[item.checkId] = item.decision;
    }
  }
  return { decisions, depositScheduleRows: depositRows.map((row) => ({ ...row })), managementDecisions };
}

export function cashflowMonthCloseReviewProgress(input: {
  cells: CashflowMonthCloseCell[];
  decisions: CashflowMonthCloseDecisionMap;
  depositScheduleRows: CashflowMonthCloseDepositReviewRow[];
  managementChecks?: CashflowManagementCheck[];
  managementDecisions?: CashflowManagementDecisionMap;
}): { confirmedCells: number; totalCells: number; confirmedDepositRows: number; confirmedManagementChecks: number; complete: boolean } {
  const confirmedCells = input.cells.filter((cell) => (
    input.decisions[cashflowMonthCloseConfirmationKey(cell)] === requiredCashflowMonthCloseDecision(cell)
  )).length;
  const confirmedDepositRows = input.depositScheduleRows.filter((row) => {
    if (row.decision === 'NOT_APPLICABLE') {
      return !row.taxInvoiceIssuedDate
        && !row.expectedDepositDate
        && row.expectedDepositAmount == null
        && !row.actualDepositDate
        && row.actualDepositAmount == null
        && row.actualSource === 'NOT_APPLICABLE';
    }
    const hasExpected = Boolean(row.taxInvoiceIssuedDate || row.expectedDepositDate || row.expectedDepositAmount != null);
    const hasActual = Boolean(row.actualDepositDate || row.actualDepositAmount != null);
    return (hasExpected || hasActual)
      && (hasActual ? row.actualSource !== 'NOT_APPLICABLE' : row.actualSource === 'NOT_APPLICABLE');
  }).length;
  const confirmedManagementChecks = (input.managementChecks || []).filter((check) => (
    ['CONFIRMED', 'NOT_APPLICABLE'].includes(String(input.managementDecisions?.[check.id] || ''))
  )).length;
  return {
    confirmedCells,
    totalCells: input.cells.length,
    confirmedDepositRows,
    confirmedManagementChecks,
    complete: input.cells.length > 0
      && confirmedCells === input.cells.length
      && confirmedDepositRows === CASHFLOW_MONTH_CLOSE_WEEK_NOS.length
      && (input.managementChecks || []).length === 4
      && confirmedManagementChecks === 4,
  };
}
