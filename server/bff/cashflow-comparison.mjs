import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from './cashflow-policy.mjs';
import { resolveFinanceWeekForDate } from '../../src/app/platform/cashflow-week-core.mjs';

const KNOWN_LINES = new Set(CASHFLOW_ALL_LINES);
const IN_LINES = new Set(CASHFLOW_IN_LINES);
const OUT_LINES = new Set(CASHFLOW_OUT_LINES);
const SEOUL_TIME_ZONE = 'Asia/Seoul';
const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: SEOUL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function finiteAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function collectModeWeeks(mode = {}, ignoredLineIds) {
  const weeks = new Map();
  for (const week of Array.isArray(mode?.weeks) ? mode.weeks : []) {
    const weekNo = Number(week?.weekNo);
    if (!Number.isFinite(weekNo)) continue;
    const amounts = weeks.get(weekNo) || new Map();
    for (const [lineId, rawAmount] of Object.entries(week?.amounts || {})) {
      if (!KNOWN_LINES.has(lineId)) {
        ignoredLineIds.add(lineId);
        continue;
      }
      amounts.set(lineId, finiteAmount(amounts.get(lineId)) + finiteAmount(rawAmount));
    }
    weeks.set(weekNo, amounts);
  }
  return weeks;
}

function modeTotals(lines, field) {
  const totalIn = lines
    .filter((line) => IN_LINES.has(line.lineId))
    .reduce((sum, line) => sum + line[field], 0);
  const totalOut = lines
    .filter((line) => OUT_LINES.has(line.lineId))
    .reduce((sum, line) => sum + line[field], 0);
  return { totalIn, totalOut, balance: totalIn - totalOut };
}

function differenceTotals(projection, actual) {
  return {
    totalIn: projection.totalIn - actual.totalIn,
    totalOut: projection.totalOut - actual.totalOut,
    balance: projection.balance - actual.balance,
  };
}

function addTotals(left, right) {
  return {
    totalIn: left.totalIn + right.totalIn,
    totalOut: left.totalOut + right.totalOut,
    balance: left.balance + right.balance,
  };
}

const EMPTY_TOTALS = Object.freeze({ totalIn: 0, totalOut: 0, balance: 0 });

export function resolveCashflowComparisonAsOf(rawAsOfDate, now = new Date()) {
  const asOfDate = String(rawAsOfDate || '').trim() || SEOUL_DATE_FORMATTER.format(now);
  const financeWeek = resolveFinanceWeekForDate(asOfDate);
  if (!financeWeek) throw new Error('Invalid cashflow comparison as-of date');
  return {
    asOfDate,
    asOfWeek: { yearMonth: financeWeek.yearMonth, weekNo: financeWeek.weekNo },
    timeZone: SEOUL_TIME_ZONE,
  };
}

function isAtOrBeforeAsOf(yearMonth, weekNo, asOfWeek) {
  return yearMonth < asOfWeek.yearMonth
    || (yearMonth === asOfWeek.yearMonth && weekNo <= asOfWeek.weekNo);
}

export function buildCashflowProjectionActualComparison(snapshot = {}, options = {}) {
  const boundary = options?.asOfWeek ? options : resolveCashflowComparisonAsOf(options?.asOfDate, options?.now);
  const ignoredLineIds = new Set();
  const months = (Array.isArray(snapshot?.readModel?.months) ? snapshot.readModel.months : [])
    .map((month) => {
      const yearMonth = String(month?.yearMonth || '');
      const projectionWeeks = collectModeWeeks(month?.projection, ignoredLineIds);
      const actualWeeks = collectModeWeeks(month?.actual, ignoredLineIds);
      const weekNumbers = [...new Set([...projectionWeeks.keys(), ...actualWeeks.keys()])]
        .filter((weekNo) => isAtOrBeforeAsOf(yearMonth, weekNo, boundary.asOfWeek))
        .sort((a, b) => a - b);
      const weeks = weekNumbers.map((weekNo) => {
        const projection = projectionWeeks.get(weekNo) || new Map();
        const actual = actualWeeks.get(weekNo) || new Map();
        const lines = CASHFLOW_ALL_LINES.map((lineId) => {
          const projectionHadValue = projection.has(lineId);
          const actualHadValue = actual.has(lineId);
          const projectionAmount = projectionHadValue ? finiteAmount(projection.get(lineId)) : 0;
          const actualAmount = actualHadValue ? finiteAmount(actual.get(lineId)) : 0;
          return {
            lineId,
            direction: IN_LINES.has(lineId) ? 'IN' : 'OUT',
            projection: projectionAmount,
            projectionHadValue,
            actual: actualAmount,
            actualHadValue,
            difference: projectionAmount - actualAmount,
          };
        });
        const projectionTotals = modeTotals(lines, 'projection');
        const actualTotals = modeTotals(lines, 'actual');
        const difference = differenceTotals(projectionTotals, actualTotals);
        return {
          weekNo,
          amounts: Object.fromEntries(lines.map((line) => [line.lineId, line.difference])),
          totalIn: difference.totalIn,
          totalOut: difference.totalOut,
          net: difference.balance,
          lines,
          totals: {
            projection: projectionTotals,
            actual: actualTotals,
            difference,
          },
        };
      });
      const projectionTotals = weeks.reduce(
        (totals, week) => addTotals(totals, week.totals.projection),
        { ...EMPTY_TOTALS },
      );
      const actualTotals = weeks.reduce(
        (totals, week) => addTotals(totals, week.totals.actual),
        { ...EMPTY_TOTALS },
      );
      const difference = differenceTotals(projectionTotals, actualTotals);
      return {
        yearMonth,
        weeks,
        rowTotals: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [
          lineId,
          weeks.reduce((sum, week) => sum + finiteAmount(week.amounts[lineId]), 0),
        ])),
        totalIn: difference.totalIn,
        totalOut: difference.totalOut,
        net: difference.balance,
        totals: {
          projection: projectionTotals,
          actual: actualTotals,
          difference,
        },
      };
    })
    .filter((month) => month.yearMonth)
    .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth));

  return {
    projectId: snapshot?.projectId || '',
    direction: 'projection_minus_actual',
    asOfDate: boundary.asOfDate,
    asOfWeek: boundary.asOfWeek,
    timeZone: boundary.timeZone,
    lineOrder: [...CASHFLOW_ALL_LINES],
    months,
    ignoredLineIds: [...ignoredLineIds].sort(),
  };
}
