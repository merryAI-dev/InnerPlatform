import { readOptionalText } from './bff-utils.mjs';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from './cashflow-policy.mjs';

function isWholeWon(value) {
  return Number.isSafeInteger(Number(value));
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
  // 금액이 있다고 표시된 줄만 합계 대상이다. 그 중 원 단위 정수가 아닌 값은
  // 합계에서 빼되 조용히 버리지 않고 invalidCellCount 로 드러낸다.
  const amountLineIds = CASHFLOW_ALL_LINES.filter((lineId) => ['VALUE', 'ZERO'].includes(readOptionalText(states[lineId])));
  const lineAmounts = Object.fromEntries(amountLineIds
    .filter((lineId) => isWholeWon(values[lineId]))
    .map((lineId) => [lineId, Number(values[lineId])]));
  const totalIn = CASHFLOW_IN_LINES.reduce((sum, lineId) => sum + (lineAmounts[lineId] ?? 0), 0);
  const totalOut = CASHFLOW_OUT_LINES.reduce((sum, lineId) => sum + (lineAmounts[lineId] ?? 0), 0);
  return {
    source: 'ANNUAL',
    coverage: {
      status: 'ANNUAL_ONLY',
      weekCount: 0,
      expectedWeekCount: 60,
      monthCount: 0,
      expectedMonthCount: 12,
    },
    valueCellCount: CASHFLOW_ALL_LINES.filter((lineId) => readOptionalText(states[lineId]) === 'VALUE' && isWholeWon(values[lineId])).length,
    emptyCellCount: CASHFLOW_ALL_LINES.filter((lineId) => readOptionalText(states[lineId]) === 'EMPTY').length,
    invalidCellCount: amountLineIds.filter((lineId) => !isWholeWon(values[lineId])).length,
    lineAmounts,
    lineStates: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, readOptionalText(states[lineId]) || 'EMPTY'])),
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    reconciliation: { status: 'NOT_APPLICABLE', mismatchedLineIds: [] },
  };
}
