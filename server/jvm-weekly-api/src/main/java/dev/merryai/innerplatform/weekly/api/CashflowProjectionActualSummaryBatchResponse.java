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
        BigDecimal projectionAmount,
        BigDecimal actualAmount,
        BigDecimal projectionActualDifferenceAmount,
        BigDecimal settlementDifferenceAmount,
        boolean settlementMatches,
        List<PeriodSummary> periods
    ) {
        public Item {
            periods = periods == null ? List.of() : List.copyOf(periods);
        }

        public Item(
            String projectId,
            String fromMonth,
            ComparisonAsOfWeek comparisonAsOfWeek,
            BigDecimal projectionAmount,
            BigDecimal actualAmount,
            BigDecimal projectionActualDifferenceAmount,
            BigDecimal settlementDifferenceAmount,
            boolean settlementMatches
        ) {
            this(projectId, fromMonth, comparisonAsOfWeek, projectionAmount, actualAmount,
                projectionActualDifferenceAmount, settlementDifferenceAmount, settlementMatches, List.of());
        }

        public Item(
            String projectId,
            String fromMonth,
            ComparisonAsOfWeek comparisonAsOfWeek,
            BigDecimal settlementDifferenceAmount,
            boolean settlementMatches
        ) {
            this(
                projectId, fromMonth, comparisonAsOfWeek,
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                settlementDifferenceAmount, settlementMatches, List.of()
            );
        }
    }

    public record ComparisonAsOfWeek(String yearMonth, int weekNo) {}

    public record PeriodSummary(
        String period,
        BigDecimal projectionAmount,
        BigDecimal actualAmount,
        BigDecimal projectionActualDifferenceAmount
    ) {}

    public record ErrorItem(String projectId, String code) {}
}
