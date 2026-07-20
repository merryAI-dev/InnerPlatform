package dev.merryai.innerplatform.weekly.api;

public record CashflowMonthDashboardSourceResponse(
    CashflowMonthCloseResponse monthClose,
    CashflowSnapshotResponse cashflow
) {
}
