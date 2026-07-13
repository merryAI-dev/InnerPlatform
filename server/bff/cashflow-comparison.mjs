import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from './cashflow-policy.mjs';

const KNOWN_LINES = new Set(CASHFLOW_ALL_LINES);
const IN_LINES = new Set(CASHFLOW_IN_LINES);
const OUT_LINES = new Set(CASHFLOW_OUT_LINES);

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

export function buildCashflowProjectionActualComparison(snapshot = {}) {
  const ignoredLineIds = new Set();
  const months = (Array.isArray(snapshot?.readModel?.months) ? snapshot.readModel.months : [])
    .map((month) => {
      const projectionWeeks = collectModeWeeks(month?.projection, ignoredLineIds);
      const actualWeeks = collectModeWeeks(month?.actual, ignoredLineIds);
      const weekNumbers = [...new Set([...projectionWeeks.keys(), ...actualWeeks.keys()])].sort((a, b) => a - b);
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
        return {
          weekNo,
          lines,
          totals: {
            projection: projectionTotals,
            actual: actualTotals,
            difference: differenceTotals(projectionTotals, actualTotals),
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
      return {
        yearMonth: String(month?.yearMonth || ''),
        weeks,
        totals: {
          projection: projectionTotals,
          actual: actualTotals,
          difference: differenceTotals(projectionTotals, actualTotals),
        },
      };
    })
    .filter((month) => month.yearMonth)
    .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth));

  return {
    projectId: snapshot?.projectId || '',
    direction: 'projection_minus_actual',
    lineOrder: [...CASHFLOW_ALL_LINES],
    months,
    ignoredLineIds: [...ignoredLineIds].sort(),
  };
}
