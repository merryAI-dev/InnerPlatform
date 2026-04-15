import cashflowPolicyData from '../../src/app/policies/cashflow-policy.json' with { type: 'json' };

export const CASHFLOW_IN_LINES = cashflowPolicyData.lineEntries
  .filter((entry) => entry.direction === 'IN')
  .map((entry) => entry.lineId);

export const CASHFLOW_OUT_LINES = cashflowPolicyData.lineEntries
  .filter((entry) => entry.direction === 'OUT')
  .map((entry) => entry.lineId);

export const CASHFLOW_ALL_LINES = [...CASHFLOW_IN_LINES, ...CASHFLOW_OUT_LINES];

export const CASHFLOW_SHEET_LINE_LABELS = Object.fromEntries(
  cashflowPolicyData.lineEntries.map((entry) => [entry.lineId, entry.label]),
);

export function getCashflowLineLabel(lineId) {
  if (!lineId) return '';
  return CASHFLOW_SHEET_LINE_LABELS[lineId] || lineId;
}
