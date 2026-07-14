import { describe, expect, it } from 'vitest';
import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import type { CashflowSheetLabMirrorResult } from '../../lib/sheets-cashflow-readonly-client';
import {
  applyCashflowMonthCloseProjectionDrafts,
  buildCashflowMonthCloseDraftInput,
  cashflowMonthCloseConfirmationKey,
  createEmptyCashflowMonthCloseDepositRows,
  cashflowMonthCloseReviewProgress,
  normalizeCashflowMonthCloseCells,
  requiredCashflowMonthCloseDecision,
} from './cashflow-month-close';

function mirror(): CashflowSheetLabMirrorResult {
  return {
    projectId: 'project-1',
    status: 'FRESH',
    sourceRevision: 'sheet-r1',
    targetRevisionAtFetch: 'ledger-r1',
    yearMonths: ['2026-07'],
    cells: (['projection', 'actual'] as const).flatMap((mode) => (
      [1, 2, 3, 4, 5].flatMap((weekNo) => CASHFLOW_ALL_LINES.map((lineId, index) => ({
        mode,
        yearMonth: '2026-07',
        weekNo,
        lineId,
        direction: index < 7 ? 'IN' as const : 'OUT' as const,
        sourceCell: `${mode}-${weekNo}-${lineId}`,
        sourceLabel: `${weekNo}주 ${lineId}`,
        state: index % 2 === 0 ? 'VALUE' as const : 'EMPTY' as const,
        amount: index % 2 === 0 ? index * 1000 : undefined,
      })))
    )),
  };
}

describe('cashflow month close contract', () => {
  it('normalizes exactly 160 pinned cells in Projection then Actual order', () => {
    const cells = normalizeCashflowMonthCloseCells(mirror(), '2026-07');
    expect(cells).toHaveLength(160);
    expect(cells[0]).toMatchObject({ mode: 'projection', weekNo: 1, cashflowLine: CASHFLOW_ALL_LINES[0] });
    expect(cells[80]).toMatchObject({ mode: 'actual', weekNo: 1, cashflowLine: CASHFLOW_ALL_LINES[0] });
  });

  it('requires a human decision for every value and empty cell', () => {
    expect(() => buildCashflowMonthCloseDraftInput({
      mirror: mirror(),
      yearMonth: '2026-07',
      decisions: {},
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
    })).toThrow('확인');
  });

  it('keeps untouched deposit rows incomplete until a human chooses an action', () => {
    const cells = normalizeCashflowMonthCloseCells(mirror(), '2026-07');
    const decisions = Object.fromEntries(cells.map((cell) => [
      cashflowMonthCloseConfirmationKey(cell),
      requiredCashflowMonthCloseDecision(cell),
    ]));
    const progress = cashflowMonthCloseReviewProgress({
      cells,
      decisions,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
    });
    expect(progress.confirmedDepositRows).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it('uses selected-month Projection edits in the final close cells', () => {
    const source = mirror();
    const original = normalizeCashflowMonthCloseCells(source, '2026-07');
    const lineId = CASHFLOW_ALL_LINES[1];
    const key = `2026-07:projection:1:${lineId}`;
    const cells = applyCashflowMonthCloseProjectionDrafts(original, { [key]: '12,345' }, '2026-07');
    const decisions = Object.fromEntries(cells.map((cell) => [
      cashflowMonthCloseConfirmationKey(cell),
      requiredCashflowMonthCloseDecision(cell),
    ]));

    const result = buildCashflowMonthCloseDraftInput({
      mirror: source,
      yearMonth: '2026-07',
      decisions,
      projectionDrafts: { [key]: '12,345' },
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows().map((row) => ({
        ...row,
        decision: 'NOT_APPLICABLE' as const,
      })),
    });

    expect(result.cells.find((cell) => cell.mode === 'projection' && cell.weekNo === 1 && cell.cashflowLine === lineId))
      .toMatchObject({ cellState: 'VALUE', amount: 12_345 });
  });

  it('builds the server draft only after all 160 cells and five rows are explicit', () => {
    const source = mirror();
    const cells = normalizeCashflowMonthCloseCells(source, '2026-07');
    const decisions = Object.fromEntries(cells.map((cell) => [
      cashflowMonthCloseConfirmationKey(cell),
      requiredCashflowMonthCloseDecision(cell),
    ]));
    const result = buildCashflowMonthCloseDraftInput({
      mirror: source,
      yearMonth: '2026-07',
      decisions,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows().map((row) => ({
        ...row,
        decision: 'NOT_APPLICABLE' as const,
      })),
    });
    expect(result.sourceRevision).toBe('sheet-r1');
    expect(result.targetRevision).toBe('ledger-r1');
    expect(result.cells).toHaveLength(160);
    expect(result.confirmations).toHaveLength(160);
    expect(result.depositScheduleRows).toHaveLength(5);
  });

  it('rejects an invalid or incomplete pinned mirror', () => {
    const source = mirror();
    source.cells = source.cells?.slice(0, -1);
    expect(() => normalizeCashflowMonthCloseCells(source, '2026-07')).toThrow('159/160');
  });
});
