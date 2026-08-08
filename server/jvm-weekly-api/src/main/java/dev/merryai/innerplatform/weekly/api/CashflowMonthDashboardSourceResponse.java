package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowMonthDashboardSourceResponse(
    CashflowMonthCloseResponse monthClose,
    CashflowSnapshotResponse cashflow,
    CashflowOpeningBalancesResponse openingBalances,
    SnapshotCompatibility snapshotCompatibility,
    CumulativeClose cumulativeClose,
    CashflowProjectionActualSummaryBatchResponse.Item projectionActualSummary,
    List<Blocker> blockers
) {
    public CashflowMonthDashboardSourceResponse(
        CashflowMonthCloseResponse monthClose,
        CashflowSnapshotResponse cashflow,
        CashflowOpeningBalancesResponse openingBalances,
        SnapshotCompatibility snapshotCompatibility,
        CumulativeClose cumulativeClose,
        CashflowProjectionActualSummaryBatchResponse.Item projectionActualSummary
    ) {
        this(monthClose, cashflow, openingBalances, snapshotCompatibility, cumulativeClose, projectionActualSummary, List.of());
    }

    public CashflowMonthDashboardSourceResponse(
        CashflowMonthCloseResponse monthClose,
        CashflowSnapshotResponse cashflow,
        CashflowOpeningBalancesResponse openingBalances,
        SnapshotCompatibility snapshotCompatibility
    ) {
        this(monthClose, cashflow, openingBalances, snapshotCompatibility, new CumulativeClose("OPEN", "2023-01", "", "", 0), null, List.of());
    }

    public CashflowMonthDashboardSourceResponse {
        blockers = blockers == null ? List.of() : List.copyOf(blockers);
    }

    public record Blocker(String code, String message) {}

    public record CumulativeClose(
        String status,
        String fromMonth,
        String closedThrough,
        String rootHash,
        long headRevision
    ) {}
    public record SnapshotCompatibility(
        String status,
        List<String> missingEvidence
    ) {
        public SnapshotCompatibility {
            missingEvidence = missingEvidence == null ? List.of() : List.copyOf(missingEvidence);
        }
    }
}
