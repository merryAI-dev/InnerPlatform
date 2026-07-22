import { readOptionalText } from './bff-utils.mjs';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from './cashflow-policy.mjs';

function wholeWon(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : 0;
}

export function cashflowAnnualTotalDocPath(tenantId, projectId, year) {
  const id = Buffer.from(`${projectId}\n${Number(year)}`, 'utf8').toString('base64url');
  return `orgs/${tenantId}/cashflow_sheet_year_totals/${id}`;
}

export function summarizeCashflowAnnualMode(document, mode) {
  const values = document?.[mode] && typeof document[mode] === 'object' ? document[mode] : {};
  const states = document?.[`${mode}States`] && typeof document[`${mode}States`] === 'object'
    ? document[`${mode}States`]
    : {};
  const lineAmounts = Object.fromEntries(CASHFLOW_ALL_LINES.flatMap((lineId) => (
    ['VALUE', 'ZERO'].includes(readOptionalText(states[lineId])) && Number.isSafeInteger(Number(values[lineId]))
      ? [[lineId, Number(values[lineId])]]
      : []
  )));
  const totalIn = CASHFLOW_IN_LINES.reduce((sum, lineId) => sum + wholeWon(lineAmounts[lineId]), 0);
  const totalOut = CASHFLOW_OUT_LINES.reduce((sum, lineId) => sum + wholeWon(lineAmounts[lineId]), 0);
  return {
    source: 'ANNUAL',
    coverage: {
      status: 'ANNUAL_ONLY',
      weekCount: 0,
      expectedWeekCount: 60,
      monthCount: 0,
      expectedMonthCount: 12,
    },
    valueCellCount: CASHFLOW_ALL_LINES.filter((lineId) => readOptionalText(states[lineId]) === 'VALUE').length,
    emptyCellCount: CASHFLOW_ALL_LINES.filter((lineId) => readOptionalText(states[lineId]) === 'EMPTY').length,
    invalidCellCount: 0,
    lineAmounts,
    lineStates: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, readOptionalText(states[lineId]) || 'EMPTY'])),
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    reconciliation: { status: 'NOT_APPLICABLE', mismatchedLineIds: [] },
  };
}
