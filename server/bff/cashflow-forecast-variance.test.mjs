import { describe, expect, it } from 'vitest';
import {
  buildCashflowForecastVariance,
  summarizeCashflowForecastVariance,
} from './cashflow-forecast-variance.mjs';

const formula = (mode, yearMonth, weekNo, reported) => ({
  mode,
  yearMonth,
  weekNo,
  reported,
  sourceCells: {
    openingBalance: 'A1',
    depositTotal: 'A2',
    withdrawalTotal: 'A3',
    balance: 'A4',
  },
});

const baseline = (overrides = {}) => ({
  contractVersion: 'cashflow-forecast-baseline-v1',
  status: 'AVAILABLE',
  capturedFromYearMonth: '2026-07',
  capturedFromWeekNo: 3,
  yearMonth: '2026-07',
  weekNo: 4,
  sourceRevision: 'sha256:baseline-source',
  targetRevision: 'sha256:baseline-target',
  reported: {
    openingBalance: 1_000,
    depositTotal: 500,
    withdrawalTotal: 200,
    balance: 1_300,
  },
  ...overrides,
});

const completion = (projectId, forecastBaseline = baseline()) => ({
  projectId,
  yearMonth: '2026-07',
  weekNo: 3,
  sourceRevision: forecastBaseline.sourceRevision,
  targetRevision: forecastBaseline.targetRevision,
  snapshot: { forecastBaseline },
});

const mirror = (checks) => ({
  weeklyYear: 2026,
  status: 'FRESH',
  sourceRevision: 'sha256:actual-source',
  appliedSourceRevision: 'sha256:actual-source',
  targetRevisionAtFetch: 'sha256:actual-target',
  appliedTargetRevision: 'sha256:actual-target',
  sheetFacts: { weeklyCalculationChecks: checks },
});

const actual = formula('actual', '2026-07', 4, {
  openingBalance: 1_000,
  depositTotal: 450,
  withdrawalTotal: 250,
  balance: 1_200,
});

const previousActual = formula('actual', '2026-07', 3, {
  openingBalance: 900,
  depositTotal: 350,
  withdrawalTotal: 250,
  balance: 1_000,
});

describe('cashflow forecast variance', () => {
  it('joins the locked Projection baseline with the matching current Sheet Actual formula', () => {
    const result = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [completion('project-a')],
      mirror: mirror([previousActual, actual]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(result).toMatchObject({
      status: 'AVAILABLE',
      eligibleCount: 1,
      coverageCount: 1,
      rows: [{
        status: 'AVAILABLE',
        projectId: 'project-a',
        yearMonth: '2026-07',
        weekNo: 4,
        variance: {
          openingBalance: 0,
          depositTotal: 50,
          withdrawalTotal: -50,
          balance: 100,
        },
      }],
    });
    expect(result.rows[0].actual.sourceCells.openingBalance).toBe('A4');
  });

  it('reports partial enterprise coverage without inventing a zero for an unavailable baseline', () => {
    const available = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [completion('project-a')],
      mirror: mirror([previousActual, actual]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });
    const unavailableBaseline = baseline({ status: 'UNAVAILABLE', reason: 'SHEET_REVISION_MISMATCH' });
    const unavailable = buildCashflowForecastVariance({
      projectId: 'project-b',
      completions: [completion('project-b', unavailableBaseline)],
      mirror: mirror([]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(unavailable.rows[0]).toMatchObject({
      status: 'UNAVAILABLE',
      projectId: 'project-b',
      reason: 'BASELINE_UNAVAILABLE',
      variance: null,
    });
    expect(summarizeCashflowForecastVariance([available, unavailable])).toMatchObject({
      status: 'PARTIAL',
      complete: false,
      eligibleCount: 2,
      coverageCount: 1,
      totals: {
        complete: false,
        variance: {
          openingBalance: 0,
          depositTotal: 50,
          withdrawalTotal: -50,
          balance: 100,
        },
      },
    });
  });

  it('returns unavailable and null totals before any activation-era baseline exists', () => {
    const project = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [],
      mirror: mirror([]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(project).toMatchObject({ status: 'UNAVAILABLE', eligibleCount: 0, coverageCount: 0, rows: [] });
    expect(summarizeCashflowForecastVariance([project])).toMatchObject({
      status: 'UNAVAILABLE',
      eligibleCount: 0,
      coverageCount: 0,
      totals: { baseline: null, actual: null, variance: null },
    });
  });

  it('excludes legacy baselines outside the Sheet-declared weekly year', () => {
    const legacyBaseline = baseline({
      capturedFromYearMonth: '2023-11',
      yearMonth: '2023-12',
    });
    const result = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [completion('project-a', legacyBaseline)],
      mirror: mirror([]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(result).toMatchObject({
      status: 'UNAVAILABLE',
      eligibleCount: 0,
      coverageCount: 0,
      rows: [],
    });
    expect(JSON.stringify(result)).not.toContain('2023');
  });

  it.each([
    ['missing', true],
    ['unavailable', false],
  ])('excludes a legacy 2023 completion when the Sheet mirror is %s', (_state, mirrorAvailable) => {
    const legacyBaseline = baseline({
      capturedFromYearMonth: '2023-11',
      yearMonth: '2023-12',
    });
    const legacyCompletion = {
      ...completion('project-a', legacyBaseline),
      yearMonth: '2023-11',
    };

    const result = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [legacyCompletion],
      mirror: null,
      completionsAvailable: true,
      mirrorAvailable,
    });

    expect(result).toMatchObject({
      status: 'UNAVAILABLE',
      eligibleCount: 0,
      coverageCount: 0,
      rows: [],
    });
    expect(JSON.stringify(result)).not.toContain('2023');
  });

  it('keeps a weekly-year completion eligible when its Projection baseline is missing', () => {
    const result = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [{
        projectId: 'project-a',
        yearMonth: '2026-07',
        weekNo: 3,
        snapshot: {},
      }],
      mirror: mirror([]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(result).toMatchObject({
      status: 'UNAVAILABLE',
      eligibleCount: 1,
      coverageCount: 0,
      rows: [{
        status: 'UNAVAILABLE',
        reason: 'BASELINE_MISSING',
        projectId: 'project-a',
      }],
    });
  });

  it('does not compare against a Sheet snapshot whose target revision was not applied', () => {
    const staleMirror = mirror([actual]);
    staleMirror.appliedTargetRevision = 'sha256:different-target';

    const result = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [completion('project-a')],
      mirror: staleMirror,
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(result.rows[0]).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'MIRROR_REVISION_MISMATCH',
      actual: null,
      variance: null,
    });
  });

  it.each([
    ['Projection', baseline({ reported: { ...baseline().reported, depositTotal: 500.5 } }), actual, 'BASELINE_VALUE_INVALID'],
    ['Actual', baseline(), { ...actual, reported: { ...actual.reported, depositTotal: 450.5 } }, 'ACTUAL_VALUE_INVALID'],
  ])('does not publish fractional won values from %s', (_source, forecastBaseline, actualCheck, reason) => {
    const result = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [completion('project-a', forecastBaseline)],
      mirror: mirror([previousActual, actualCheck]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(result.rows[0]).toMatchObject({ status: 'UNAVAILABLE', reason, variance: null });
  });

  it('does not publish a variance when subtracting safe won values overflows', () => {
    const forecastBaseline = baseline({
      reported: { ...baseline().reported, balance: Number.MAX_SAFE_INTEGER },
    });
    const actualCheck = {
      ...actual,
      reported: { ...actual.reported, balance: -1 },
    };

    const result = buildCashflowForecastVariance({
      projectId: 'project-a',
      completions: [completion('project-a', forecastBaseline)],
      mirror: mirror([previousActual, actualCheck]),
      completionsAvailable: true,
      mirrorAvailable: true,
    });

    expect(result.rows[0]).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'VARIANCE_VALUE_INVALID',
      variance: null,
    });
  });

  it('does not publish enterprise totals when safe project values overflow during aggregation', () => {
    const row = (amount) => ({
      status: 'AVAILABLE',
      baseline: { reported: Object.fromEntries(['openingBalance', 'depositTotal', 'withdrawalTotal', 'balance'].map((key) => [key, amount])) },
      actual: { reported: Object.fromEntries(['openingBalance', 'depositTotal', 'withdrawalTotal', 'balance'].map((key) => [key, 0])) },
      variance: Object.fromEntries(['openingBalance', 'depositTotal', 'withdrawalTotal', 'balance'].map((key) => [key, amount])),
    });

    const result = summarizeCashflowForecastVariance([
      { eligibleCount: 1, rows: [row(Number.MAX_SAFE_INTEGER)] },
      { eligibleCount: 1, rows: [row(1)] },
    ]);

    expect(result).toMatchObject({
      status: 'PARTIAL',
      eligibleCount: 2,
      coverageCount: 2,
      totals: { baseline: null, actual: null, variance: null },
    });
  });
});
