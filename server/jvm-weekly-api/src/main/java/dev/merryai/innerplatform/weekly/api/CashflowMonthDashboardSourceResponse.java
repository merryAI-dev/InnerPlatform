package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowMonthDashboardSourceResponse(
    CashflowMonthCloseResponse monthClose,
    CashflowSnapshotResponse cashflow,
    CashflowOpeningBalancesResponse openingBalances,
    SnapshotCompatibility snapshotCompatibility
) {
    public record SnapshotCompatibility(
        String status,
        List<String> missingEvidence
    ) {
        public SnapshotCompatibility {
            missingEvidence = missingEvidence == null ? List.of() : List.copyOf(missingEvidence);
        }
    }
}
