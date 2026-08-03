package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowSettlementStatusesBatchResponse(
    List<CashflowSettlementStatusesResponse> items,
    List<ErrorItem> errors
) {
    public static final String STATUS_UNAVAILABLE = "STATUS_UNAVAILABLE";

    public CashflowSettlementStatusesBatchResponse {
        items = items == null ? List.of() : List.copyOf(items);
        errors = errors == null ? List.of() : List.copyOf(errors);
        if (items.size() + errors.size() > CashflowSettlementStatusesBatchRequest.MAX_PROJECT_COUNT) {
            throw new IllegalArgumentException("Cashflow settlement status batch response exceeds the project limit.");
        }
    }

    public record ErrorItem(String projectId, String code) {}
}
