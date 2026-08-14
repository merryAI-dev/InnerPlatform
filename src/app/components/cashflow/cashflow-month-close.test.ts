import { describe, expect, it } from 'vitest';
import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import type { CashflowSheetLabMirrorResult } from '../../lib/sheets-cashflow-readonly-client';
import type { CashflowDeadlineSummary, CashflowManagementCheck } from '../../lib/platform-bff-client';
import {
  buildCashflowMonthCloseDraftInput,
  createEmptyCashflowMonthCloseDepositRows,
  isCashflowMonthCloseRequestForSelection,
  normalizeCashflowMonthCloseCells,
  requiredCashflowMonthCloseDecision,
  shouldApplyCashflowMonthCloseRequestResult,
  shouldHideCashflowValuesAfterLoadError,
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

const managementChecks: CashflowManagementCheck[] = [
  { id: 'labor-transfer', status: 'OK', title: '인건비', detail: '확인' },
  { id: 'profit-vat-after-deposit', status: 'OK', title: '수익·부가세', detail: '확인' },
  { id: 'negative-projection-balance', status: 'OK', title: '잔액', detail: '확인' },
  { id: 'future-prepay-over-million', status: 'OK', title: '선입금', detail: '확인' },
];
const deadlineSummary: CashflowDeadlineSummary = {
  trackingStartedAt: null,
  missedCount: 0,
  completedCount: 0,
  current: null,
};

describe('cashflow month close contract', () => {
  it('accepts a loaded approval request only for the selected project and month', () => {
    const request = { projectId: 'project-1', yearMonth: '2026-07' };

    expect(isCashflowMonthCloseRequestForSelection(request, 'project-1', '2026-07')).toBe(true);
    expect(isCashflowMonthCloseRequestForSelection(request, 'project-2', '2026-07')).toBe(false);
    expect(isCashflowMonthCloseRequestForSelection(request, 'project-1', '2026-08')).toBe(false);
    expect(isCashflowMonthCloseRequestForSelection(null, 'project-1', '2026-07')).toBe(false);
  });

  it('hides values only when canonical loading failed without a retained model', () => {
    expect(shouldHideCashflowValuesAfterLoadError('409 conflict', false)).toBe(true);
    expect(shouldHideCashflowValuesAfterLoadError('409 conflict', true)).toBe(false);
    expect(shouldHideCashflowValuesAfterLoadError(null, false)).toBe(false);
  });
  it('rejects stale request reads by generation and selected month', () => {
    expect(shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration: 3,
      currentGeneration: 3,
      requestedProjectId: 'project-1',
      selectedProjectId: 'project-1',
      requestedYearMonth: '2026-07',
      selectedYearMonth: '2026-07',
    })).toBe(true);
    expect(shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration: 2,
      currentGeneration: 3,
      requestedProjectId: 'project-1',
      selectedProjectId: 'project-1',
      requestedYearMonth: '2026-07',
      selectedYearMonth: '2026-07',
    })).toBe(false);
    expect(shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration: 3,
      currentGeneration: 3,
      requestedProjectId: 'project-1',
      selectedProjectId: 'project-1',
      requestedYearMonth: '2026-06',
      selectedYearMonth: '2026-07',
    })).toBe(false);
    expect(shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration: 3,
      currentGeneration: 3,
      requestedProjectId: 'project-1',
      selectedProjectId: 'project-2',
      requestedYearMonth: '2026-07',
      selectedYearMonth: '2026-07',
    })).toBe(false);
  });

  it('normalizes exactly 160 pinned cells in Projection then Actual order', () => {
    const cells = normalizeCashflowMonthCloseCells(mirror(), '2026-07');
    expect(cells).toHaveLength(160);
    expect(cells[0]).toMatchObject({ mode: 'projection', weekNo: 1, cashflowLine: CASHFLOW_ALL_LINES[0] });
    expect(cells[80]).toMatchObject({ mode: 'actual', weekNo: 1, cashflowLine: CASHFLOW_ALL_LINES[0] });
  });

  it('preserves an explicit weekly zero as a confirmed value', () => {
    const source = mirror();
    source.cells![0] = { ...source.cells![0], state: 'ZERO', amount: 0 };
    const [cell] = normalizeCashflowMonthCloseCells(source, '2026-07');
    expect(cell).toMatchObject({ cellState: 'ZERO', amount: 0 });
    expect(requiredCashflowMonthCloseDecision(cell)).toBe('CONFIRMED');
  });

  it('rejects a VALUE cell whose sheet amount is missing instead of coercing it to zero', () => {
    const source = mirror();
    source.cells![0] = { ...source.cells![0], state: 'VALUE', amount: null } as unknown as NonNullable<typeof source.cells>[number];

    expect(() => normalizeCashflowMonthCloseCells(source, '2026-07'))
      .toThrow('금액을 확인해 주세요');
  });

  it('derives confirmations from the pinned sheet after the single human review', () => {
    const result = buildCashflowMonthCloseDraftInput({
      mirror: mirror(),
      yearMonth: '2026-07',
      humanReviewed: true,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
      managementChecks,
      deadlineSummary,
    });
    expect(result.confirmations).toHaveLength(160);
    expect(result.confirmations[0]?.decision).toBe('CONFIRMED');
    expect(result.confirmations[1]?.decision).toBe('NOT_APPLICABLE');
  });

  it('still requires the single human review checkbox', () => {
    expect(() => buildCashflowMonthCloseDraftInput({
      mirror: mirror(),
      yearMonth: '2026-07',
      humanReviewed: false,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
      managementChecks,
      deadlineSummary,
    })).toThrow('직접 확인');
  });

  it('derives empty deposit rows as not applicable without extra controls', () => {
    const result = buildCashflowMonthCloseDraftInput({
      mirror: mirror(),
      yearMonth: '2026-07',
      humanReviewed: true,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
      managementChecks,
      deadlineSummary,
    });
    expect(result.depositScheduleRows.every((row) => row.decision === 'NOT_APPLICABLE')).toBe(true);
  });

  it('uses selected-month Projection edits in the final close cells', () => {
    const source = mirror();
    const lineId = CASHFLOW_ALL_LINES[1];
    const key = `2026-07:projection:1:${lineId}`;
    const result = buildCashflowMonthCloseDraftInput({
      mirror: source,
      yearMonth: '2026-07',
      humanReviewed: true,
      projectionDrafts: { [key]: '12,345' },
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
      managementChecks,
      deadlineSummary,
    });

    expect(result.cells.find((cell) => cell.mode === 'projection' && cell.weekNo === 1 && cell.cashflowLine === lineId))
      .toMatchObject({ cellState: 'VALUE', amount: 12_345 });
  });

  it('builds the compatible server draft from the one review confirmation', () => {
    const source = mirror();
    const result = buildCashflowMonthCloseDraftInput({
      mirror: source,
      yearMonth: '2026-07',
      humanReviewed: true,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
      managementChecks,
      deadlineSummary,
    });
    expect(result.sourceRevision).toBe('sheet-r1');
    expect(result.targetRevision).toBe('ledger-r1');
    expect(result.cells).toHaveLength(160);
    expect(result.confirmations).toHaveLength(160);
    expect(result.depositScheduleRows).toHaveLength(5);
    expect(result.managementConfirmations).toEqual([]);
  });

  it('rejects an invalid or incomplete pinned mirror', () => {
    const source = mirror();
    source.cells = source.cells?.slice(0, -1);
    expect(() => normalizeCashflowMonthCloseCells(source, '2026-07')).toThrow('159/160');
  });
});
