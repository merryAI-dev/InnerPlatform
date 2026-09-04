export function cashflowMonthCloseRequestPath(tenantId, requestId) {
  return `orgs/${tenantId}/cashflow_month_close_requests/${requestId}`;
}

export function cashflowMonthCloseRequestAuditPath(tenantId, requestId, revision, action) {
  return `orgs/${tenantId}/cashflow_month_close_request_audits/${requestId}-r${revision}-${action}`;
}
