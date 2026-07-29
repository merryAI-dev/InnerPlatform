import { describe, expect, it } from 'vitest';
import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import type { CashflowSheetLabMirrorResult } from '../../lib/sheets-cashflow-readonly-client';
import type { CashflowDeadlineSummary, CashflowManagementCheck } from '../../lib/platform-bff-client';
import {
  applyCashflowMonthCloseProjectionDrafts,
  buildCashflowMonthCloseDraftInput,
  carryForwardCashflowRunningBalances,
  cashflowMonthCloseConfirmationKey,
  createEmptyCashflowMonthCloseDepositRows,
  cashflowMonthCloseReviewProgress,
  normalizeCashflowMonthCloseCells,
  requiredCashflowMonthCloseDecision,
  resolveCashflowEvidenceScope,
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
const managementDecisions = Object.fromEntries(managementChecks.map((check) => [check.id, 'CONFIRMED' as const]));
const deadlineSummary: CashflowDeadlineSummary = {
  trackingStartedAt: null,
  missedCount: 0,
  completedCount: 0,
  current: null,
};

describe('cashflow month close contract', () => {
  it('does not expose live annual rows or mirror metadata to a legacy closed view', () => {
    const scope = resolveCashflowEvidenceScope({
      projectId: 'project-1',
      yearMonth: '2026-07',
      monthClose: {
        projectId: 'project-1',
        yearMonth: '2026-07',
        status: 'CLOSED',
        dashboard: {
          snapshotCompatibility: { status: 'LEGACY_EVIDENCE_ONLY' },
          sheetMetadata: {},
        },
      },
      liveYearView: { projectId: 'project-1', status: 'FRESH', selectedYear: 2026, years: [], canonicalAnnualYears: [], navigationYears: [2026], availableYears: [2026], readModelStatus: 'CURRENT', fallbackYears: [], mismatchYears: [] },
      liveSheetMetadata: { businessType: { sourceCell: 'B2', value: 'LIVE-SENTINEL' } },
    });

    expect(scope.allowLiveAnnualYearView).toBe(false);
    expect(scope.yearView).toBeNull();
    expect(scope.sheetMetadata).toBeUndefined();
    expect(JSON.stringify(scope)).not.toContain('LIVE-SENTINEL');
  });

  it('uses frozen metadata for a closed view instead of current mirror metadata', () => {
    const scope = resolveCashflowEvidenceScope({
      projectId: 'project-1',
      yearMonth: '2026-07',
      monthClose: {
        projectId: 'project-1',
        yearMonth: '2026-07',
        status: 'CLOSED',
        dashboard: {
          snapshotCompatibility: { status: 'FROZEN_COMPLETE' },
          sheetMetadata: { businessType: { sourceCell: 'B2', value: 'FROZEN' } },
        },
      },
      liveYearView: null,
      liveSheetMetadata: { businessType: { sourceCell: 'B2', value: 'LIVE-SENTINEL' } },
    });

    expect(scope.sheetMetadata?.businessType?.value).toBe('FROZEN');
    expect(JSON.stringify(scope)).not.toContain('LIVE-SENTINEL');
  });

  it('rejects an OPEN result from another project before resolving live evidence', () => {
    const scope = resolveCashflowEvidenceScope({
      projectId: 'project-2',
      yearMonth: '2026-07',
      monthClose: { projectId: 'project-1', yearMonth: '2026-07', status: 'OPEN' },
      liveYearView: { projectId: 'project-2', status: 'FRESH', selectedYear: 2026, years: [], canonicalAnnualYears: [], navigationYears: [2026], availableYears: [2026], readModelStatus: 'CURRENT', fallbackYears: [], mismatchYears: [] },
      liveSheetMetadata: { businessType: { sourceCell: 'B2', value: 'LIVE-SENTINEL' } },
    });

    expect(scope.allowLiveAnnualYearView).toBe(false);
    expect(scope.yearView).toBeNull();
    expect(scope.sheetMetadata).toBeUndefined();
  });
  it('carries prior weekly net and annual-only opening through empty weeks', () => {
    expect(carryForwardCashflowRunningBalances({
      priorWeeklyNet: 3_000_000,
      annualOpeningBalance: 2_000_000,
      serverRunningNets: [null, 3_500_000, null, 2_750_000],
    })).toEqual([5_000_000, 5_500_000, 5_500_000, 4_750_000]);
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

  it('requires a human decision for every value and empty cell', () => {
    expect(() => buildCashflowMonthCloseDraftInput({
      mirror: mirror(),
      yearMonth: '2026-07',
      humanReviewed: true,
      decisions: {},
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows(),
      managementChecks,
      managementDecisions: {},
      deadlineSummary,
    })).toThrow('확인');
  });

  it('does not turn a server-derived cell state into a confirmation without an explicit review', () => {
    const cells = normalizeCashflowMonthCloseCells(mirror(), '2026-07');
    const decisions = Object.fromEntries(cells.map((cell) => [
      cashflowMonthCloseConfirmationKey(cell),
      requiredCashflowMonthCloseDecision(cell),
    ]));
    expect(() => buildCashflowMonthCloseDraftInput({
      mirror: mirror(),
      yearMonth: '2026-07',
      humanReviewed: false,
      decisions,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows().map((row) => ({ ...row, decision: 'NOT_APPLICABLE' as const })),
      managementChecks,
      managementDecisions,
      deadlineSummary,
    })).toThrow('직접 확인');
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
      humanReviewed: true,
      decisions,
      projectionDrafts: { [key]: '12,345' },
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows().map((row) => ({
        ...row,
        decision: 'NOT_APPLICABLE' as const,
      })),
      managementChecks,
      managementDecisions,
      deadlineSummary,
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
      humanReviewed: true,
      decisions,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows().map((row) => ({
        ...row,
        decision: 'NOT_APPLICABLE' as const,
      })),
      managementChecks,
      managementDecisions,
      deadlineSummary,
    });
    expect(result.sourceRevision).toBe('sheet-r1');
    expect(result.targetRevision).toBe('ledger-r1');
    expect(result.cells).toHaveLength(160);
    expect(result.confirmations).toHaveLength(160);
    expect(result.depositScheduleRows).toHaveLength(5);
    expect(result.managementConfirmations).toHaveLength(4);
  });

  it('does not turn an unreviewed management check into an automatic confirmation', () => {
    const source = mirror();
    const cells = normalizeCashflowMonthCloseCells(source, '2026-07');
    const decisions = Object.fromEntries(cells.map((cell) => [
      cashflowMonthCloseConfirmationKey(cell),
      requiredCashflowMonthCloseDecision(cell),
    ]));
    expect(() => buildCashflowMonthCloseDraftInput({
      mirror: source,
      yearMonth: '2026-07',
      humanReviewed: true,
      decisions,
      depositScheduleRows: createEmptyCashflowMonthCloseDepositRows().map((row) => ({
        ...row,
        decision: 'NOT_APPLICABLE' as const,
      })),
      managementChecks,
      managementDecisions: { ...managementDecisions, 'labor-transfer': undefined },
      deadlineSummary,
    })).toThrow('확인 또는 해당 없음');
  });

  it('rejects an invalid or incomplete pinned mirror', () => {
    const source = mirror();
    source.cells = source.cells?.slice(0, -1);
    expect(() => normalizeCashflowMonthCloseCells(source, '2026-07')).toThrow('159/160');
  });
});
