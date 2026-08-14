package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowMonthDashboardSourceResponse(
    CashflowMonthCloseResponse monthClose,
    CashflowMonthCloseResponse latestRun,
    MonthStatusEvidence monthStatusEvidence,
    CashflowSnapshotResponse cashflow,
    CashflowOpeningBalancesResponse openingBalances,
    SnapshotCompatibility snapshotCompatibility,
    CumulativeClose cumulativeClose,
    CashflowProjectionActualSummaryBatchResponse.Item projectionActualSummary,
    List<Blocker> blockers,
    List<SectionError> sectionErrors,
    ActionCapability reopenRequest
) {
    public CashflowMonthDashboardSourceResponse(
        CashflowMonthCloseResponse monthClose,
        CashflowSnapshotResponse cashflow,
        CashflowOpeningBalancesResponse openingBalances,
        SnapshotCompatibility snapshotCompatibility,
        CumulativeClose cumulativeClose,
        CashflowProjectionActualSummaryBatchResponse.Item projectionActualSummary,
        List<Blocker> blockers
    ) {
        this(
            monthClose, monthClose, null, cashflow, openingBalances, snapshotCompatibility, cumulativeClose,
            projectionActualSummary, blockers, List.of(), ActionCapability.unavailable()
        );
    }

    public CashflowMonthDashboardSourceResponse(
        CashflowMonthCloseResponse monthClose,
        CashflowSnapshotResponse cashflow,
        CashflowOpeningBalancesResponse openingBalances,
        SnapshotCompatibility snapshotCompatibility,
        CumulativeClose cumulativeClose,
        CashflowProjectionActualSummaryBatchResponse.Item projectionActualSummary
    ) {
        this(
            monthClose, monthClose, null, cashflow, openingBalances, snapshotCompatibility, cumulativeClose,
            projectionActualSummary, List.of(), List.of(), ActionCapability.unavailable()
        );
    }

    public CashflowMonthDashboardSourceResponse(
        CashflowMonthCloseResponse monthClose,
        CashflowSnapshotResponse cashflow,
        CashflowOpeningBalancesResponse openingBalances,
        SnapshotCompatibility snapshotCompatibility
    ) {
        this(
            monthClose, monthClose, null, cashflow, openingBalances, snapshotCompatibility, CumulativeClose.missing(),
            null, List.of(), List.of(), ActionCapability.unavailable()
        );
    }

    public CashflowMonthDashboardSourceResponse {
        latestRun = latestRun == null ? monthClose : latestRun;
        monthStatusEvidence = monthStatusEvidence == null
            ? new MonthStatusEvidence(
                "CUMULATIVE_CLOSE_HEAD", "MISSING",
                monthClose == null ? null : monthClose.status(),
                latestRun == null ? null : latestRun.status(),
                null, null
            )
            : monthStatusEvidence;
        blockers = blockers == null ? List.of() : List.copyOf(blockers);
        sectionErrors = sectionErrors == null ? List.of() : List.copyOf(sectionErrors);
        reopenRequest = reopenRequest == null ? ActionCapability.unavailable() : reopenRequest;
    }

    public record Blocker(String code, String message) {}

    public record SectionError(String section, String code) {}

    public record ActionCapability(boolean enabled, String reasonCode) {
        public static ActionCapability unavailable() {
            return new ActionCapability(false, "CUMULATIVE_CLOSE_AUTHORITY_UNAVAILABLE");
        }
    }

    public record MonthStatusEvidence(
        String authority,
        String authorityAvailability,
        String operationalStatus,
        String latestRunStatus,
        String closedThrough,
        String issueCode
    ) {}

    public record CumulativeClose(
        String availability,
        String status,
        String fromMonth,
        String settlementMonth,
        String closedThrough,
        String rootHash,
        Long headRevision
    ) {
        public static CumulativeClose missing() {
            return unavailable("MISSING");
        }

        public static CumulativeClose unavailable(String availability) {
            return new CumulativeClose(availability, null, null, null, null, null, null);
        }
    }
    public record SnapshotCompatibility(
        String status,
        List<String> missingEvidence
    ) {
        public SnapshotCompatibility {
            missingEvidence = missingEvidence == null ? List.of() : List.copyOf(missingEvidence);
        }
    }
}
