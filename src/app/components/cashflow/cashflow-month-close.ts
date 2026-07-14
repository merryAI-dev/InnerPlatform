import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import type {
  CashflowMonthCloseCell,
  CashflowMonthCloseConfirmation,
  CashflowMonthCloseDepositScheduleRow,
  CashflowMonthCloseDraftInput,
} from '../../lib/platform-bff-client';
import type { CashflowSheetLabMirrorResult } from '../../lib/sheets-cashflow-readonly-client';

export type CashflowMonthCloseDecision = CashflowMonthCloseConfirmation['decision'];
export type CashflowMonthCloseDecisionMap = Record<string, CashflowMonthCloseDecision | undefined>;
export type CashflowMonthCloseDepositReviewRow = Omit<CashflowMonthCloseDepositScheduleRow, 'decision'> & {
  decision: CashflowMonthCloseDepositScheduleRow['decision'] | null;
};

export const CASHFLOW_MONTH_CLOSE_WEEK_NOS = [1, 2, 3, 4, 5] as const;

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
  return cell.cellState === 'VALUE' ? 'CONFIRMED' : 'NOT_APPLICABLE';
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
    throw new Error('시트 고정본의 원본/원장 버전을 확인할 수 없습니다.');
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
    const amount = source.state === 'VALUE' ? Number(source.amount) : null;
    if (source.state === 'VALUE' && !Number.isFinite(amount)) {
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
    if (row.decision !== 'CONFIRMED' && row.decision !== 'NOT_APPLICABLE') {
      throw new Error(`${weekNo}주차 입금 일정을 확인 또는 해당 없음 처리해 주세요.`);
    }
    if (row.decision === 'NOT_APPLICABLE') {
      if (
        row.taxInvoiceIssuedDate
        || row.expectedDepositDate
        || row.expectedDepositAmount != null
        || row.actualDepositDate
        || row.actualDepositAmount != null
        || row.actualSource !== 'NOT_APPLICABLE'
      ) {
        throw new Error(`${weekNo}주차를 해당 없음으로 처리하려면 입력값을 비워 주세요.`);
      }
      return { ...row, decision: 'NOT_APPLICABLE' };
    }

    const hasExpected = Boolean(row.taxInvoiceIssuedDate || row.expectedDepositDate || row.expectedDepositAmount != null);
    const hasActual = Boolean(row.actualDepositDate || row.actualDepositAmount != null);
    if (!hasExpected && !hasActual) {
      throw new Error(`${weekNo}주차 입금 일정은 값을 입력하거나 해당 없음을 선택해 주세요.`);
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
  decisions: CashflowMonthCloseDecisionMap;
  depositScheduleRows: CashflowMonthCloseDepositReviewRow[];
  projectionDrafts?: Record<string, string>;
}): CashflowMonthCloseDraftInput {
  const cells = applyCashflowMonthCloseProjectionDrafts(
    normalizeCashflowMonthCloseCells(input.mirror, input.yearMonth),
    input.projectionDrafts || {},
    input.yearMonth,
  );
  const confirmations = cells.map<CashflowMonthCloseConfirmation>((cell) => {
    const key = cashflowMonthCloseConfirmationKey(cell);
    const requiredDecision = requiredCashflowMonthCloseDecision(cell);
    const decision = input.decisions[key];
    if (decision !== requiredDecision) {
      throw new Error(`${cell.sourceLabel || cell.sourceCell || key} 항목을 ${requiredDecision === 'CONFIRMED' ? '확인' : '해당 없음'} 처리해 주세요.`);
    }
    return {
      mode: cell.mode,
      weekNo: cell.weekNo,
      cashflowLine: cell.cashflowLine,
      decision,
    };
  });

  assertPinnedMirror(input.mirror, input.yearMonth);
  return {
    sourceRevision: input.mirror.sourceRevision,
    targetRevision: input.mirror.targetRevisionAtFetch,
    yearMonth: input.yearMonth,
    depositScheduleRows: normalizeDepositRows(input.depositScheduleRows),
    cells,
    confirmations,
  };
}

export function readCashflowMonthCloseReview(value: unknown, yearMonth: string): {
  decisions: CashflowMonthCloseDecisionMap;
  depositScheduleRows: CashflowMonthCloseDepositReviewRow[];
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as {
    yearMonth?: unknown;
    confirmations?: unknown;
    depositScheduleRows?: unknown;
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
  return { decisions, depositScheduleRows: depositRows.map((row) => ({ ...row })) };
}

export function cashflowMonthCloseReviewProgress(input: {
  cells: CashflowMonthCloseCell[];
  decisions: CashflowMonthCloseDecisionMap;
  depositScheduleRows: CashflowMonthCloseDepositReviewRow[];
}): { confirmedCells: number; totalCells: number; confirmedDepositRows: number; complete: boolean } {
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
  return {
    confirmedCells,
    totalCells: input.cells.length,
    confirmedDepositRows,
    complete: input.cells.length > 0
      && confirmedCells === input.cells.length
      && confirmedDepositRows === CASHFLOW_MONTH_CLOSE_WEEK_NOS.length,
  };
}
