export const CASHFLOW_SETTLEMENT_CYCLE_CUTOFF_MONTH = '2026-09';

export function isHistoricalCashflowSettlementCycle(yearMonth) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)
    && yearMonth < CASHFLOW_SETTLEMENT_CYCLE_CUTOFF_MONTH;
}

export function cashflowMonthCloseRequestPath(tenantId, requestId) {
  return `orgs/${tenantId}/cashflow_month_close_requests/${requestId}`;
}
