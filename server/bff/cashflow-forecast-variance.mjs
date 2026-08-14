import { safeAmount, sumSafe } from './cashflow-amounts.mjs';

const FORECAST_BASELINE_CONTRACT_VERSION = 'cashflow-forecast-baseline-v1';
const METRICS = [
  ['openingBalance', '기초 잔액'],
  ['depositTotal', '입금 합계'],
  ['withdrawalTotal', '출금 합계'],
  ['balance', '기말 잔액'],
];
const YEAR_MONTH_PATTERN = /^(20\d{2})-(0[1-9]|1[0-2])$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validWeekNo(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function amountLabel(value) {
  const amount = safeAmount(value);
  return amount === null ? '값 없음' : `${new Intl.NumberFormat('ko-KR').format(amount)}원`;
}

function weekLabel(yearMonth, weekNo) {
  const match = text(yearMonth).match(YEAR_MONTH_PATTERN);
  const normalizedWeekNo = validWeekNo(weekNo);
  if (!match || normalizedWeekNo === null) return '대상 주차 없음';
  return `${match[1]}년 ${Number(match[2])}월 ${normalizedWeekNo}주차`;
}

function reasonLabel(reason) {
  return {
    COMPLETION_STORE_UNAVAILABLE: '주간 완료 이력 조회 불가',
    MIRROR_STORE_UNAVAILABLE: 'Sheet mirror 조회 불가',
    BASELINE_MISSING: '고정된 Projection 기준선 없음',
    BASELINE_CONTRACT_INVALID: '기준선 계약 버전 오류',
    BASELINE_UNAVAILABLE: 'Projection 기준선 사용 불가',
    BASELINE_VALUE_INVALID: 'Projection 기준선 값 누락',
    BASELINE_REVISION_MISMATCH: '기준선 lineage 리비전 불일치',
    MIRROR_MISSING: '현재 Sheet mirror 없음',
    MIRROR_REVISION_MISMATCH: '현재 Sheet mirror 미반영 또는 리비전 불일치',
    ACTUAL_MISSING: '대상 주차 Actual 수식값 없음',
    ACTUAL_AMBIGUOUS: '대상 주차 Actual 수식값 중복',
    ACTUAL_VALUE_INVALID: '대상 주차 Actual 값 누락',
    ACTUAL_SOURCE_UNAVAILABLE: '대상 주차 Actual 셀 출처 누락',
    VARIANCE_VALUE_INVALID: 'Projection–Actual 편차 계산 불가',
  }[reason] || '비교 불가';
}

function normalizedReported(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [key] of METRICS) {
    const amount = safeAmount(source[key]);
    if (amount === null) return null;
    result[key] = amount;
  }
  return result;
}

function sourceCells(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, cell]) => [key, text(cell)])
      .filter(([, cell]) => cell),
  );
}

function previousFinanceWeek(yearMonth, weekNo) {
  if (weekNo > 1) return { yearMonth, weekNo: weekNo - 1 };
  const match = text(yearMonth).match(YEAR_MONTH_PATTERN);
  if (!match) return null;
  const previousMonth = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1))
    .toISOString().slice(0, 7);
  return { yearMonth: previousMonth, weekNo: 5 };
}

function actualWithCanonicalOpeningSource(check, checks, mirror) {
  const cells = sourceCells(check?.sourceCells);
  const yearMonth = text(check?.yearMonth);
  const weekNo = validWeekNo(check?.weekNo);
  const weeklyYear = Number.isSafeInteger(mirror?.weeklyYear) ? mirror.weeklyYear : null;
  const firstWeeklyCheck = weeklyYear !== null && yearMonth === `${weeklyYear}-01` && weekNo === 1;
  if (!firstWeeklyCheck) {
    const previous = previousFinanceWeek(yearMonth, weekNo);
    const matches = previous ? checks.filter((candidate) => (
      text(candidate?.mode).toLowerCase() === 'actual'
      && text(candidate?.yearMonth) === previous.yearMonth
      && validWeekNo(candidate?.weekNo) === previous.weekNo
    )) : [];
    const openingSource = matches.length === 1 ? sourceCells(matches[0].sourceCells).balance : '';
    if (!openingSource) return null;
    cells.openingBalance = openingSource;
  }
  return METRICS.every(([key]) => cells[key]) ? { ...check, sourceCells: cells } : null;
}

function unavailableRow({ completion, baseline, reason }) {
  const yearMonth = text(baseline?.yearMonth) || null;
  const weekNo = validWeekNo(baseline?.weekNo);
  return {
    status: 'UNAVAILABLE',
    statusLabel: reasonLabel(reason),
    reason,
    reasonLabel: reasonLabel(reason),
    projectId: text(completion?.projectId) || null,
    yearMonth,
    weekNo,
    weekLabel: weekLabel(yearMonth, weekNo),
    baseline: baseline ? {
      contractVersion: text(baseline.contractVersion) || null,
      status: text(baseline.status).toUpperCase() || 'UNAVAILABLE',
      reason: text(baseline.reason) || null,
      capturedFromYearMonth: text(baseline.capturedFromYearMonth) || null,
      capturedFromWeekNo: validWeekNo(baseline.capturedFromWeekNo),
      capturedAt: text(baseline.capturedAt) || null,
      capturedByUid: text(baseline.capturedByUid) || null,
      sourceRevision: text(baseline.sourceRevision) || null,
      targetRevision: text(baseline.targetRevision) || null,
      reported: normalizedReported(baseline.reported),
      sourceCells: sourceCells(baseline.sourceCells),
    } : null,
    actual: null,
    variance: null,
    metrics: [],
  };
}

function availableRow({ completion, baseline, mirror, actual }) {
  const baselineReported = normalizedReported(baseline.reported);
  const actualReported = normalizedReported(actual.reported);
  const variance = {};
  const metrics = [];
  for (const [key, label] of METRICS) {
    const difference = safeAmount(baselineReported[key] - actualReported[key]);
    if (difference === null) return null;
    variance[key] = difference;
    metrics.push({
      key,
      label,
      baseline: baselineReported[key],
      baselineLabel: amountLabel(baselineReported[key]),
      actual: actualReported[key],
      actualLabel: amountLabel(actualReported[key]),
      variance: difference,
      varianceLabel: amountLabel(difference),
    });
  }
  const yearMonth = text(baseline.yearMonth);
  const weekNo = validWeekNo(baseline.weekNo);
  return {
    status: 'AVAILABLE',
    statusLabel: '비교 가능',
    reason: null,
    reasonLabel: null,
    projectId: text(completion.projectId) || null,
    yearMonth,
    weekNo,
    weekLabel: weekLabel(yearMonth, weekNo),
    baseline: {
      contractVersion: text(baseline.contractVersion),
      status: 'AVAILABLE',
      reason: null,
      capturedFromYearMonth: text(baseline.capturedFromYearMonth) || null,
      capturedFromWeekNo: validWeekNo(baseline.capturedFromWeekNo),
      capturedAt: text(baseline.capturedAt) || null,
      capturedByUid: text(baseline.capturedByUid) || null,
      sourceRevision: text(baseline.sourceRevision),
      targetRevision: text(baseline.targetRevision),
      reported: baselineReported,
      sourceCells: sourceCells(baseline.sourceCells),
    },
    actual: {
      sourceRevision: text(mirror.sourceRevision),
      targetRevision: text(mirror.appliedTargetRevision) || null,
      reported: actualReported,
      sourceCells: sourceCells(actual.sourceCells),
    },
    variance,
    metrics,
  };
}

function compareRows(left, right) {
  const month = text(left.yearMonth).localeCompare(text(right.yearMonth));
  if (month !== 0) return month;
  return (left.weekNo || 0) - (right.weekNo || 0);
}

function belongsToWeeklyYear(yearMonth, weeklyYear) {
  const match = text(yearMonth).match(YEAR_MONTH_PATTERN);
  return Boolean(match) && Number(match[1]) === weeklyYear;
}

export function buildCashflowForecastVariance({
  projectId,
  completions,
  mirror,
  completionsAvailable,
  mirrorAvailable,
}) {
  if (!completionsAvailable) {
    return {
      status: 'UNAVAILABLE', statusLabel: reasonLabel('COMPLETION_STORE_UNAVAILABLE'),
      eligibleCount: 0, coverageCount: 0, coverageLabel: '비교 가능 0/0주차', rows: [],
    };
  }

  const weeklyYear = Number.isSafeInteger(mirror?.weeklyYear) ? mirror.weeklyYear : null;
  const projectCompletions = (Array.isArray(completions) ? completions : [])
    .filter((completion) => text(completion?.projectId) === projectId)
    .filter((completion) => {
      if (weeklyYear === null || !belongsToWeeklyYear(completion?.yearMonth, weeklyYear)) return false;
      const baselineYearMonth = text(completion?.snapshot?.forecastBaseline?.yearMonth);
      return !baselineYearMonth || belongsToWeeklyYear(baselineYearMonth, weeklyYear);
    });
  const rows = projectCompletions.map((completion) => {
    const baseline = completion?.snapshot?.forecastBaseline;
    if (!baseline || typeof baseline !== 'object') {
      return unavailableRow({ completion, baseline: null, reason: 'BASELINE_MISSING' });
    }
    if (text(baseline.contractVersion) !== FORECAST_BASELINE_CONTRACT_VERSION) {
      return unavailableRow({ completion, baseline, reason: 'BASELINE_CONTRACT_INVALID' });
    }
    if (text(baseline.status).toUpperCase() !== 'AVAILABLE') {
      return unavailableRow({ completion, baseline, reason: 'BASELINE_UNAVAILABLE' });
    }
    if (!normalizedReported(baseline.reported)) {
      return unavailableRow({ completion, baseline, reason: 'BASELINE_VALUE_INVALID' });
    }
    if (
      !text(baseline.sourceRevision)
      || !text(baseline.targetRevision)
      || text(completion.sourceRevision) !== text(baseline.sourceRevision)
      || text(completion.targetRevision) !== text(baseline.targetRevision)
    ) {
      return unavailableRow({ completion, baseline, reason: 'BASELINE_REVISION_MISMATCH' });
    }
    if (!mirrorAvailable) return unavailableRow({ completion, baseline, reason: 'MIRROR_STORE_UNAVAILABLE' });
    if (!mirror) return unavailableRow({ completion, baseline, reason: 'MIRROR_MISSING' });
    if (
      text(mirror.status).toUpperCase() !== 'FRESH'
      || !text(mirror.sourceRevision)
      || text(mirror.sourceRevision) !== text(mirror.appliedSourceRevision)
      || !text(mirror.targetRevisionAtFetch)
      || text(mirror.targetRevisionAtFetch) !== text(mirror.appliedTargetRevision)
    ) {
      return unavailableRow({ completion, baseline, reason: 'MIRROR_REVISION_MISMATCH' });
    }
    const calculationChecks = Array.isArray(mirror?.sheetFacts?.weeklyCalculationChecks)
      ? mirror.sheetFacts.weeklyCalculationChecks
      : [];
    const actualMatches = calculationChecks.filter((check) => (
        text(check?.mode).toLowerCase() === 'actual'
        && text(check?.yearMonth) === text(baseline.yearMonth)
        && validWeekNo(check?.weekNo) === validWeekNo(baseline.weekNo)
      ));
    if (actualMatches.length === 0) return unavailableRow({ completion, baseline, reason: 'ACTUAL_MISSING' });
    if (actualMatches.length > 1) return unavailableRow({ completion, baseline, reason: 'ACTUAL_AMBIGUOUS' });
    if (!normalizedReported(actualMatches[0].reported)) {
      return unavailableRow({ completion, baseline, reason: 'ACTUAL_VALUE_INVALID' });
    }
    const canonicalActual = actualWithCanonicalOpeningSource(actualMatches[0], calculationChecks, mirror);
    if (!canonicalActual) {
      return unavailableRow({ completion, baseline, reason: 'ACTUAL_SOURCE_UNAVAILABLE' });
    }
    return availableRow({ completion, baseline, mirror, actual: canonicalActual })
      || unavailableRow({ completion, baseline, reason: 'VARIANCE_VALUE_INVALID' });
  }).sort(compareRows);

  const eligibleCount = rows.length;
  const coverageCount = rows.filter((row) => row.status === 'AVAILABLE').length;
  const status = coverageCount > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
  return {
    status,
    statusLabel: status === 'AVAILABLE' ? '편차 비교 가능' : '편차 비교 불가',
    eligibleCount,
    coverageCount,
    coverageLabel: `비교 가능 ${coverageCount}/${eligibleCount}주차`,
    rows,
  };
}

export function summarizeCashflowForecastVariance(projectVariances) {
  const values = Array.isArray(projectVariances) ? projectVariances : [];
  const rows = values.flatMap((value) => Array.isArray(value?.rows) ? value.rows : []);
  const availableRows = rows.filter((row) => row.status === 'AVAILABLE');
  const eligibleCount = rows.length;
  const coverageCount = availableRows.length;
  const aggregate = (selector) => Object.fromEntries(METRICS.map(([key]) => [
    key,
    sumSafe(availableRows.map((row) => selector(row, key))),
  ]));
  const baseline = aggregate((row, key) => row.baseline.reported[key]);
  const actual = aggregate((row, key) => row.actual.reported[key]);
  const variance = aggregate((row, key) => row.variance[key]);
  const totalsAvailable = availableRows.length > 0
    && [...Object.values(baseline), ...Object.values(actual), ...Object.values(variance)]
      .every((value) => value !== null);
  const metrics = METRICS.map(([key, label]) => ({
    key,
    label,
    baseline: totalsAvailable ? baseline[key] : null,
    baselineLabel: totalsAvailable ? amountLabel(baseline[key]) : '값 없음',
    actual: totalsAvailable ? actual[key] : null,
    actualLabel: totalsAvailable ? amountLabel(actual[key]) : '값 없음',
    variance: totalsAvailable ? variance[key] : null,
    varianceLabel: totalsAvailable ? amountLabel(variance[key]) : '값 없음',
  }));
  const status = coverageCount === 0
    ? 'UNAVAILABLE'
    : coverageCount === eligibleCount && totalsAvailable ? 'AVAILABLE'
      : 'PARTIAL';
  return {
    status,
    statusLabel: status === 'AVAILABLE' ? '전사 편차 비교 가능' : status === 'PARTIAL' ? '전사 편차 부분 비교' : '전사 편차 비교 불가',
    complete: false,
    eligibleCount,
    coverageCount,
    coverageLabel: `전사 비교 가능 ${coverageCount}/${eligibleCount}주차 · 부분 합계`,
    totals: {
      complete: false,
      baseline: totalsAvailable ? baseline : null,
      actual: totalsAvailable ? actual : null,
      variance: totalsAvailable ? variance : null,
      metrics,
    },
  };
}
