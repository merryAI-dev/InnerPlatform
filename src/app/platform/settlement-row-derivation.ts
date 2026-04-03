import { findWeekForDate, getYearMondayWeeks } from './cashflow-weeks';
import { parseDate, parseNumber } from './csv-utils';
import { importRowToTransaction, type ImportRow } from './settlement-csv';

export type SettlementDerivationMode = 'row' | 'cascade' | 'full';

export interface SettlementDerivationContext {
  projectId: string;
  defaultLedgerId: string;
  dateIdx: number;
  weekIdx: number;
  depositIdx: number;
  refundIdx: number;
  expenseIdx: number;
  vatInIdx: number;
  bankAmountIdx: number;
  balanceIdx: number;
  evidenceIdx: number;
  evidenceCompletedIdx: number;
  evidencePendingIdx: number;
}

export function isSettlementCascadeColumn(
  colIdx: number,
  context: Pick<
    SettlementDerivationContext,
    'depositIdx' | 'refundIdx' | 'expenseIdx' | 'vatInIdx' | 'bankAmountIdx' | 'balanceIdx'
  >,
): boolean {
  return [
    context.depositIdx,
    context.refundIdx,
    context.expenseIdx,
    context.vatInIdx,
    context.bankAmountIdx,
    context.balanceIdx,
  ].includes(colIdx);
}

function derivePendingEvidence(requiredDesc: string, completedDesc: string): string {
  const required = String(requiredDesc || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (required.length === 0) return '';
  const completed = String(completedDesc || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return required
    .filter((item) => !completed.some((done) => done.includes(item.toLowerCase())))
    .join(', ');
}

function updateCells(
  row: ImportRow,
  mutator: (cells: string[]) => void,
): ImportRow {
  const nextCells = [...row.cells];
  mutator(nextCells);
  const changed = nextCells.some((cell, index) => cell !== row.cells[index]);
  return changed ? { ...row, cells: nextCells } : row;
}

function deriveWeekLabel(rawDate: string): string {
  const datePart = rawDate.split(/\s+/)[0];
  let dateIso = parseDate(datePart);
  if (!dateIso) {
    const match = datePart.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    if (match) {
      dateIso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
  }
  if (!dateIso) return '';
  const weeks = getYearMondayWeeks(Number.parseInt(dateIso.slice(0, 4), 10));
  return findWeekForDate(dateIso, weeks)?.label || '';
}

function deriveRowLocally(
  row: ImportRow,
  rowIdx: number,
  context: SettlementDerivationContext,
  includeBalance: boolean,
  runningBalance: number,
): { row: ImportRow; nextRunningBalance: number } {
  let next = row;
  const userEdited = row.userEditedCells ?? new Set<number>();

  next = updateCells(next, (cells) => {
    if (context.weekIdx >= 0 && context.dateIdx >= 0) {
      const weekCell = String(cells[context.weekIdx] || '').trim();
      const rawDate = String(cells[context.dateIdx] || '').trim();
      if ((!weekCell || weekCell === '-') && rawDate) {
        const label = deriveWeekLabel(rawDate);
        if (label) cells[context.weekIdx] = label;
      }
    }

    if (
      row.entryKind === 'ADJUSTMENT'
      && context.balanceIdx >= 0
      && context.depositIdx >= 0
      && context.expenseIdx >= 0
      && context.bankAmountIdx >= 0
    ) {
      const explicitBalance = parseNumber(cells[context.balanceIdx]) ?? null;
      if (explicitBalance != null) {
        const delta = explicitBalance - runningBalance;
        if (delta > 0) {
          cells[context.depositIdx] = delta.toLocaleString('ko-KR');
          if (context.refundIdx >= 0) cells[context.refundIdx] = '';
          cells[context.expenseIdx] = '';
          if (context.vatInIdx >= 0) cells[context.vatInIdx] = '';
          cells[context.bankAmountIdx] = delta.toLocaleString('ko-KR');
        } else if (delta < 0) {
          cells[context.depositIdx] = '';
          if (context.refundIdx >= 0) cells[context.refundIdx] = '';
          cells[context.expenseIdx] = Math.abs(delta).toLocaleString('ko-KR');
          if (context.vatInIdx >= 0) cells[context.vatInIdx] = '';
          cells[context.bankAmountIdx] = Math.abs(delta).toLocaleString('ko-KR');
        } else {
          cells[context.depositIdx] = '';
          if (context.refundIdx >= 0) cells[context.refundIdx] = '';
          cells[context.expenseIdx] = '';
          if (context.vatInIdx >= 0) cells[context.vatInIdx] = '';
          cells[context.bankAmountIdx] = '';
        }
      }
    }

    if (context.bankAmountIdx >= 0 && context.expenseIdx >= 0 && context.vatInIdx >= 0) {
      const bankAmount = parseNumber(cells[context.bankAmountIdx]) ?? 0;
      const expense = parseNumber(cells[context.expenseIdx]) ?? 0;
      const vat = parseNumber(cells[context.vatInIdx]) ?? 0;
      if (bankAmount > 0) {
        if (expense > 0) {
          // 사업비 사용액이 입력되어 있으면 매입부가세를 자동 계산
          // 단, 사용자가 매입부가세 또는 사업비 사용액을 직접 수정한 경우 자동계산 스킵
          if (!userEdited.has(context.vatInIdx) && !userEdited.has(context.expenseIdx)) {
            const derivedVat = Math.max(bankAmount - expense, 0);
            cells[context.vatInIdx] = derivedVat > 0 ? derivedVat.toLocaleString('ko-KR') : '';
          }
        } else if (!userEdited.has(context.expenseIdx)) {
          // 사업비 사용액이 없으면 bankAmount - vatIn 으로 계산 (통장 import 기본)
          const derivedExpense = Math.max(bankAmount - Math.max(vat, 0), 0);
          cells[context.expenseIdx] = derivedExpense > 0 ? derivedExpense.toLocaleString('ko-KR') : '';
        }
      }
    }

    if (
      context.depositIdx >= 0
      && context.refundIdx >= 0
      && context.expenseIdx >= 0
      && context.vatInIdx >= 0
      && context.bankAmountIdx >= 0
    ) {
      const existingBankRaw = String(cells[context.bankAmountIdx] || '').trim();
      if (!existingBankRaw) {
        const depositSum = (parseNumber(cells[context.depositIdx]) ?? 0) + (parseNumber(cells[context.refundIdx]) ?? 0);
        const expenseSum = (parseNumber(cells[context.expenseIdx]) ?? 0) + (parseNumber(cells[context.vatInIdx]) ?? 0);
        const derivedBankAmount = depositSum > 0 ? depositSum : expenseSum;
        cells[context.bankAmountIdx] = Number.isFinite(derivedBankAmount) && derivedBankAmount !== 0
          ? derivedBankAmount.toLocaleString('ko-KR')
          : '';
      }
    }
  });

  let nextRunningBalance = runningBalance;
  if (includeBalance && context.balanceIdx >= 0) {
    next = updateCells(next, (cells) => {
      const existingBalanceRaw = String(cells[context.balanceIdx] || '').trim();
      const hasExistingBalance = existingBalanceRaw !== '';
      const explicitBalance = hasExistingBalance ? (parseNumber(existingBalanceRaw) ?? null) : null;
      const depositSum = context.depositIdx >= 0 && context.refundIdx >= 0
        ? (parseNumber(cells[context.depositIdx]) ?? 0) + (parseNumber(cells[context.refundIdx]) ?? 0)
        : 0;
      const expenseSum = context.expenseIdx >= 0 && context.vatInIdx >= 0
        ? (parseNumber(cells[context.expenseIdx]) ?? 0) + (parseNumber(cells[context.vatInIdx]) ?? 0)
        : 0;

      if (explicitBalance != null) {
        nextRunningBalance = explicitBalance;
        return;
      }

      if (depositSum !== 0 || expenseSum !== 0) {
        nextRunningBalance += depositSum - expenseSum;
        cells[context.balanceIdx] = Number.isFinite(nextRunningBalance)
          ? nextRunningBalance.toLocaleString('ko-KR')
          : '';
      }
    });
  }

  next = updateCells(next, (cells) => {
    if (context.evidenceIdx >= 0 && context.evidenceCompletedIdx >= 0 && context.evidencePendingIdx >= 0) {
      const requiredDesc = String(cells[context.evidenceIdx] || '');
      const completedDesc = String(cells[context.evidenceCompletedIdx] || '');
      cells[context.evidencePendingIdx] = derivePendingEvidence(requiredDesc, completedDesc);
    }
  });

  const result = importRowToTransaction(next, context.projectId, context.defaultLedgerId, rowIdx);
  if (next.error === result.error) {
    return { row: next, nextRunningBalance };
  }
  return { row: { ...next, error: result.error }, nextRunningBalance };
}

function computeRunningSeed(
  rows: ImportRow[],
  endExclusive: number,
  context: SettlementDerivationContext,
): number {
  let running = 0;
  for (let index = 0; index < endExclusive; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const cells = row.cells;
    const existingBalanceRaw = context.balanceIdx >= 0 ? String(cells[context.balanceIdx] || '').trim() : '';
    const explicitBalance = existingBalanceRaw ? (parseNumber(existingBalanceRaw) ?? null) : null;
    const depositSum = context.depositIdx >= 0 && context.refundIdx >= 0
      ? (parseNumber(cells[context.depositIdx]) ?? 0) + (parseNumber(cells[context.refundIdx]) ?? 0)
      : 0;
    const expenseSum = context.expenseIdx >= 0 && context.vatInIdx >= 0
      ? (parseNumber(cells[context.expenseIdx]) ?? 0) + (parseNumber(cells[context.vatInIdx]) ?? 0)
      : 0;
    if (explicitBalance != null) {
      running = explicitBalance;
    } else if (depositSum !== 0 || expenseSum !== 0) {
      running += depositSum - expenseSum;
    }
  }
  return running;
}

export function deriveSettlementRows(
  input: ImportRow[],
  context: SettlementDerivationContext,
  options: {
    mode: SettlementDerivationMode;
    rowIdx?: number;
  },
): ImportRow[] {
  if (input.length === 0) return input;
  if (options.mode === 'full') {
    const nextRows = [...input];
    let running = 0;
    for (let index = 0; index < nextRows.length; index += 1) {
      const derived = deriveRowLocally(nextRows[index], index, context, true, running);
      nextRows[index] = derived.row;
      running = derived.nextRunningBalance;
    }
    return nextRows;
  }

  const targetRowIdx = Math.max(0, Math.min(input.length - 1, options.rowIdx ?? 0));
  const nextRows = [...input];

  if (options.mode === 'row') {
    nextRows[targetRowIdx] = deriveRowLocally(nextRows[targetRowIdx], targetRowIdx, context, false, 0).row;
    return nextRows;
  }

  let running = computeRunningSeed(nextRows, targetRowIdx, context);
  for (let index = targetRowIdx; index < nextRows.length; index += 1) {
    const derived = deriveRowLocally(nextRows[index], index, context, true, running);
    nextRows[index] = derived.row;
    running = derived.nextRunningBalance;
  }
  return nextRows;
}
