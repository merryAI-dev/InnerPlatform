import { describe, expect, it } from 'vitest';
import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import type { CashflowSheetLabMirrorResult } from '../../lib/sheets-cashflow-readonly-client';
import type { CashflowDeadlineSummary, CashflowManagementCheck } from '../../lib/platform-bff-client';
import type { CanonicalCashflowAnnualModeTotal } from '../../lib/platform-bff-client';
import {
  annualSummaryAmountFor,
  buildCashflowMonthCloseDraftInput,
  annualYearsFor,
  canonicalCashflowAnnualTotalFor,
  carryForwardCashflowRunningBalances,
  createEmptyCashflowMonthCloseDepositRows,
  isCashflowMonthCloseRequestLocked,
  isCashflowComparisonWeekVisible,
  isCashflowWeekLockedByRange,
  normalizeCashflowMonthCloseCells,
  requiredCashflowMonthCloseDecision,
  resolveCashflowComparisonScope,
  resolveCashflowEvidenceScope,
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
  it('derives the eight annual columns from the server weekly year', () => {
    expect(annualYearsFor(2026)).toEqual([2024, 2025, 2027, 2028, 2029, 2030, 2031, 2032]);
    expect(annualYearsFor(2027)).toEqual([2025, 2026, 2028, 2029, 2030, 2031, 2032, 2033]);
    expect(annualYearsFor(undefined)).toEqual([]);
  });

  it('returns the server annual-column value and cell states unchanged', () => {
    const actual = {
      lineAmounts: { SALES_IN: 317_449_417, SALES_VAT_IN: 0, TEAM_SUPPORT_IN: 0 },
      lineStates: { SALES_IN: 'VALUE', SALES_VAT_IN: 'ZERO', TEAM_SUPPORT_IN: 'EMPTY' } as const,
      totalIn: null,
      totalOut: 0,
      net: null,
    };
    const annualTotals = [{
      year: 2025,
      projection: { ...actual, lineAmounts: { SALES_IN: 7_582_243 } },
      actual,
    }];
    const result = canonicalCashflowAnnualTotalFor(annualTotals, 2025, 'actual');

    expect(result).toBe(actual);
    expect(result).toEqual({
      lineAmounts: { SALES_IN: 317_449_417, SALES_VAT_IN: 0, TEAM_SUPPORT_IN: 0 },
      lineStates: { SALES_IN: 'VALUE', SALES_VAT_IN: 'ZERO', TEAM_SUPPORT_IN: 'EMPTY' },
      totalIn: null,
      totalOut: 0,
      net: null,
    });
    expect(canonicalCashflowAnnualTotalFor(annualTotals, 2032, 'actual')).toBeNull();
  });

  it('hides values only when canonical loading failed without a retained model', () => {
    expect(shouldHideCashflowValuesAfterLoadError('409 conflict', false)).toBe(true);
    expect(shouldHideCashflowValuesAfterLoadError('409 conflict', true)).toBe(false);
    expect(shouldHideCashflowValuesAfterLoadError(null, false)).toBe(false);
  });
  it('limits Projection-Actual comparison to the server KST finance week', () => {
    const asOfWeek = { yearMonth: '2026-08', weekNo: 3 };

    expect(isCashflowComparisonWeekVisible({ yearMonth: '2025-12', weekNo: 5 }, asOfWeek)).toBe(true);
    expect(isCashflowComparisonWeekVisible({ yearMonth: '2026-08', weekNo: 3 }, asOfWeek)).toBe(true);
    expect(isCashflowComparisonWeekVisible({ yearMonth: '2026-08', weekNo: 4 }, asOfWeek)).toBe(false);
    expect(isCashflowComparisonWeekVisible({ yearMonth: '2027-01', weekNo: 1 }, asOfWeek)).toBe(false);
    expect(isCashflowComparisonWeekVisible({ yearMonth: '2026-08', weekNo: 1 }, undefined)).toBe(false);
  });

  it('limits Projection-Actual cells and Total to the server KST comparison week', () => {
    expect(resolveCashflowComparisonScope({
      annualYears: [2024, 2025, 2026, 2027, 2032],
      weeks: [
        { yearMonth: '2026-07', weekNo: 5 },
        { yearMonth: '2026-08', weekNo: 1 },
        { yearMonth: '2026-08', weekNo: 2 },
        { yearMonth: '2026-08', weekNo: 3 },
        { yearMonth: '2026-08', weekNo: 4 },
      ],
      comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 3 },
    })).toEqual({
      annualYears: [2024, 2025],
      weeks: [
        { yearMonth: '2026-07', weekNo: 5 },
        { yearMonth: '2026-08', weekNo: 1 },
        { yearMonth: '2026-08', weekNo: 2 },
        { yearMonth: '2026-08', weekNo: 3 },
      ],
      periodLabel: '2024년 ~ 2026-08 3주차',
    });

    expect(resolveCashflowComparisonScope({
      annualYears: [],
      weeks: [{ yearMonth: '2026-01', weekNo: 1 }, { yearMonth: '2026-08', weekNo: 3 }],
      comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 3 },
    }).periodLabel).toBe('2026-01 1주차 ~ 2026-08 3주차');

    expect(resolveCashflowComparisonScope({
      annualYears: annualYearsFor(2027),
      weeks: [{ yearMonth: '2027-01', weekNo: 1 }],
      comparisonAsOfWeek: { yearMonth: '2027-01', weekNo: 1 },
    }).annualYears).toEqual([2025, 2026]);
  });

  it('locks pending approval states and unlocks a rejected request', () => {
    expect(isCashflowMonthCloseRequestLocked('PENDING')).toBe(true);
    expect(isCashflowMonthCloseRequestLocked('APPROVING')).toBe(true);
    expect(isCashflowMonthCloseRequestLocked('UNCERTAIN')).toBe(true);
    expect(isCashflowMonthCloseRequestLocked('REJECTED')).toBe(false);
  });

  it('locks every server-declared cumulative week and leaves later weeks open', () => {
    const lockRange = { fromMonth: '2023-01', fromWeekNo: 1, throughMonth: '2026-08', throughWeekNo: 5 };
    expect(isCashflowWeekLockedByRange(lockRange, '2023-01', 1)).toBe(true);
    expect(isCashflowWeekLockedByRange(lockRange, '2025-04', 3)).toBe(true);
    expect(isCashflowWeekLockedByRange(lockRange, '2026-08', 5)).toBe(true);
    expect(isCashflowWeekLockedByRange(lockRange, '2022-12', 5)).toBe(false);
    expect(isCashflowWeekLockedByRange(lockRange, '2026-09', 1)).toBe(false);
  });

  it('rejects stale request reads by generation and selected month', () => {
    expect(shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration: 3,
      currentGeneration: 3,
      requestedYearMonth: '2026-07',
      selectedYearMonth: '2026-07',
    })).toBe(true);
    expect(shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration: 2,
      currentGeneration: 3,
      requestedYearMonth: '2026-07',
      selectedYearMonth: '2026-07',
    })).toBe(false);
    expect(shouldApplyCashflowMonthCloseRequestResult({
      requestGeneration: 3,
      currentGeneration: 3,
      requestedYearMonth: '2026-06',
      selectedYearMonth: '2026-07',
    })).toBe(false);
  });

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

  it('uses refreshed mirror metadata for an open view', () => {
    const scope = resolveCashflowEvidenceScope({
      projectId: 'project-1',
      yearMonth: '2026-07',
      monthClose: {
        projectId: 'project-1',
        yearMonth: '2026-07',
        status: 'OPEN',
        dashboard: {
          sheetMetadata: { accountType: { sourceCell: 'B3', value: 'STALE' } },
        },
      },
      liveYearView: null,
      liveSheetMetadata: { accountType: { sourceCell: 'B3', value: 'REFRESHED' } },
    });

    expect(scope.sheetMetadata?.accountType?.value).toBe('REFRESHED');
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

describe('annual summary display fallback', () => {
  const base: CanonicalCashflowAnnualModeTotal = {
    lineStates: { SALES_IN: 'VALUE', SALES_VAT_IN: 'ZERO', TEAM_SUPPORT_IN: 'EMPTY', DIRECT_COST_OUT: 'VALUE' },
    lineAmounts: { SALES_IN: 7_582_243, SALES_VAT_IN: 0, DIRECT_COST_OUT: 1_000_000 },
    totalIn: null,
    totalOut: null,
    net: null,
  };

  it('falls back to the entered-line sum when the sheet totals row is not stored yet', () => {
    expect(annualSummaryAmountFor(base, 'totalIn')).toBe(7_582_243);
    expect(annualSummaryAmountFor(base, 'totalOut')).toBe(1_000_000);
    expect(annualSummaryAmountFor(base, 'net')).toBe(6_582_243);
  });

  it('prefers the stored sheet totals over the line sum', () => {
    const declared: CanonicalCashflowAnnualModeTotal = { ...base, totalIn: 8_340_487 };
    expect(annualSummaryAmountFor(declared, 'totalIn')).toBe(8_340_487);
  });

  it('keeps the summary empty only when every line is empty', () => {
    const empty: CanonicalCashflowAnnualModeTotal = {
      lineStates: { SALES_IN: 'EMPTY', DIRECT_COST_OUT: 'EMPTY' },
      lineAmounts: {},
      totalIn: null, totalOut: null, net: null,
    };
    expect(annualSummaryAmountFor(empty, 'totalIn')).toBeNull();
    expect(annualSummaryAmountFor(empty, 'net')).toBeNull();
    expect(annualSummaryAmountFor(null, 'totalIn')).toBeNull();
  });

  it('treats all-zero lines as an entered zero, not as missing', () => {
    const zero: CanonicalCashflowAnnualModeTotal = {
      lineStates: { SALES_IN: 'ZERO', DIRECT_COST_OUT: 'ZERO' },
      lineAmounts: { SALES_IN: 0, DIRECT_COST_OUT: 0 },
      totalIn: null, totalOut: null, net: null,
    };
    expect(annualSummaryAmountFor(zero, 'totalIn')).toBe(0);
    expect(annualSummaryAmountFor(zero, 'net')).toBe(0);
  });
});
