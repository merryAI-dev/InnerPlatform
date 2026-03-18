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

  next = updateCells(next, (cells) => {
    if (context.weekIdx >= 0 && context.dateIdx >= 0) {
      const weekCell = String(cells[context.weekIdx] || '').trim();
      const rawDate = String(cells[context.dateIdx] || '').trim();
      if ((!weekCell || weekCell === '-') && rawDate) {
        const label = deriveWeekLabel(rawDate);
        if (label) cells[context.weekIdx] = label;
      }
    }

    if (context.bankAmountIdx >= 0 && context.expenseIdx >= 0 && context.vatInIdx >= 0) {
      const existingExpense = String(cells[context.expenseIdx] || '').trim();
      const existingBankRaw = String(cells[context.bankAmountIdx] || '').trim();
      const bankAmount = parseNumber(existingBankRaw) ?? 0;
      const vatAmount = parseNumber(cells[context.vatInIdx]) ?? 0;
      if (bankAmount > 0 && (!existingExpense || existingExpense === '0')) {
        const derivedExpense = Math.max(bankAmount - Math.max(vatAmount, 0), 0);
        cells[context.expenseIdx] = derivedExpense > 0 ? derivedExpense.toLocaleString('ko-KR') : '';
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
