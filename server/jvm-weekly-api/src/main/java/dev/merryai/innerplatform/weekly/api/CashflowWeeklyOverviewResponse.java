package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowWeeklyOverviewResponse(
    String version,
    String yearMonth,
    List<Item> items,
    List<ErrorItem> errors
) {
    public static final String STATUS_UNAVAILABLE = "STATUS_UNAVAILABLE";
    public static final String SUMMARY_UNAVAILABLE = "SUMMARY_UNAVAILABLE";

    public CashflowWeeklyOverviewResponse {
        items = items == null ? List.of() : List.copyOf(items);
        errors = errors == null ? List.of() : List.copyOf(errors);
        if (items.size() > CashflowWeeklyOverviewRequest.MAX_PROJECT_COUNT
            || errors.size() > CashflowWeeklyOverviewRequest.MAX_PROJECT_COUNT * 2) {
            throw new IllegalArgumentException("Cashflow weekly overview response exceeds the project limit.");
        }
    }

    public record Item(
        String projectId,
        CashflowSettlementStatusesResponse settlementStatuses,
        CashflowProjectionActualSummaryBatchResponse.Item projectionActualSummary
    ) {}

    public record ErrorItem(String projectId, String code) {}
}
