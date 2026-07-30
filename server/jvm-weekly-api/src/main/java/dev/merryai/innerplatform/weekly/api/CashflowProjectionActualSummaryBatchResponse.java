package dev.merryai.innerplatform.weekly.api;

import java.math.BigDecimal;
import java.util.List;

public record CashflowProjectionActualSummaryBatchResponse(
    String version,
    List<Item> items,
    List<ErrorItem> errors
) {
    public static final String SUMMARY_UNAVAILABLE = "SUMMARY_UNAVAILABLE";

    public CashflowProjectionActualSummaryBatchResponse(String version, List<Item> items) {
        this(version, items, List.of());
    }

    public CashflowProjectionActualSummaryBatchResponse {
        items = items == null ? List.of() : List.copyOf(items);
        errors = errors == null ? List.of() : List.copyOf(errors);
        if (items.size() + errors.size() > CashflowProjectionActualSummaryBatchRequest.MAX_PROJECT_COUNT) {
            throw new IllegalArgumentException("Cashflow summary batch response exceeds the project limit.");
        }
    }

    public record Item(
        String projectId,
        String fromMonth,
        ComparisonAsOfWeek comparisonAsOfWeek,
        BigDecimal settlementDifferenceAmount,
        boolean settlementMatches
    ) {}

    public record ComparisonAsOfWeek(String yearMonth, int weekNo) {}

    public record ErrorItem(String projectId, String code) {}
}
