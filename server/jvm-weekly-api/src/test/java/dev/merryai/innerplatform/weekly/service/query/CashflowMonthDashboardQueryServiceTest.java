package dev.merryai.innerplatform.weekly.service.query;

import dev.merryai.innerplatform.weekly.domain.CashflowCumulativeCloseHead;
import dev.merryai.innerplatform.weekly.domain.CashflowLedgerSource;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthCloseState;
import dev.merryai.innerplatform.weekly.domain.CashflowOpeningBalance;
import dev.merryai.innerplatform.weekly.service.CashflowReadService;
import dev.merryai.innerplatform.weekly.service.port.CashflowReadPort;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CashflowMonthDashboardQueryServiceTest {
    private static final Clock CLOCK = Clock.fixed(
        Instant.parse("2026-08-14T03:00:00Z"), ZoneOffset.UTC
    );

    @Test
    void missingAuthorityAllowsOnlyAGenuinelyPristineFirstClose() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
            .thenReturn(monthClose("project-a", "OPEN", 0, null, null));
        when(port.findCashflowDeclaredWeeklyYear("tenant-a", "project-a")).thenReturn(2026);
        when(port.findCashflowLedgerSource("tenant-a", "project-a", 2026))
            .thenReturn(new CashflowLedgerSource(List.of(), List.of()));
        when(port.findCashflowOpeningBalance("tenant-a", "project-a", 2026))
            .thenReturn(openingBalance());

        CashflowMonthDashboardQueryService.Result result = service(port).read(
            "tenant-a", "project-a", "2026-08", "request-a"
        );

        assertThat(result.authority().availability()).isEqualTo("MISSING");
        assertThat(result.operationalStatus()).isEqualTo("OPEN");
        assertThat(result.snapshotCompatibility().status()).isEqualTo("LIVE_CURRENT");
        assertThat(result.blockers()).noneMatch(
            blocker -> blocker.code().startsWith("CUMULATIVE_CLOSE_AUTHORITY_")
        );
        assertThat(result.source()).isNotNull();
        assertThat(result.openingBalances().live()).isEqualTo(openingBalance());
    }

    @Test
    void missingAuthorityNeverPromotesAStaleClosedHistoryToOperationalStatus() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-stale", "2026-08"))
            .thenReturn(monthClose(
                "project-stale", "CLOSED", 1,
                "sha256:" + "a".repeat(64), "2026-08-31T15:00:00Z"
            ));
        when(port.findCashflowDeclaredWeeklyYear("tenant-a", "project-stale")).thenReturn(2026);
        when(port.findCashflowLedgerSource(
            "tenant-a", "project-stale", 2026, "2023-01", "2026-08"
        )).thenReturn(new CashflowLedgerSource(List.of(), List.of()));

        CashflowMonthDashboardQueryService.Result result = service(port).read(
            "tenant-a", "project-stale", "2026-08", "request-stale"
        );

        assertThat(result.latestRun().status()).isEqualTo("CLOSED");
        assertThat(result.operationalStatus()).isNull();
        assertThat(result.snapshotCompatibility().status()).isEqualTo("AUTHORITY_UNAVAILABLE");
        assertThat(result.source()).isNull();
        assertThat(result.openingBalances()).isNull();
        assertThat(result.blockers()).anySatisfy(blocker ->
            assertThat(blocker.code()).isEqualTo("CUMULATIVE_CLOSE_AUTHORITY_MISSING")
        );
        verify(port, never()).findCashflowLedgerSource("tenant-a", "project-stale", 2026);
        verify(port, never()).findCashflowGlobalLedgerSource("tenant-a", "project-stale");
        verify(port, never()).findCashflowOpeningBalance("tenant-a", "project-stale", 2026);
    }

    @Test
    void missingAuthorityNeverPromotesAnOpenRunWithHistoricalEvidence() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-stale", "2026-08"))
            .thenReturn(monthCloseWithSnapshot("project-stale", Map.of("version", 1)));

        CashflowMonthDashboardQueryService.Result result = service(port).read(
            "tenant-a", "project-stale", "2026-08", "request-stale"
        );

        assertThat(result.operationalStatus()).isNull();
        assertThat(result.source()).isNull();
        assertThat(result.blockers()).contains(
            new CashflowMonthDashboardQueryService.Blocker("CUMULATIVE_CLOSE_AUTHORITY_MISSING")
        );
    }

    @Test
    void invalidAndUnavailableAuthorityRemainTypedAndFailClosed() {
        Map<String, RuntimeException> failures = Map.of(
            "INVALID", new CashflowReadPort.InvalidCumulativeCloseAuthority(),
            "UNAVAILABLE", new CashflowReadPort.Unavailable(new RuntimeException("Firestore path"))
        );

        failures.forEach((availability, failure) -> {
            CashflowReadPort port = mock(CashflowReadPort.class);
            when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
                .thenReturn(monthClose("project-a", "OPEN", 0, null, null));
            when(port.findCashflowCumulativeCloseHead("tenant-a", "project-a")).thenThrow(failure);

            CashflowMonthDashboardQueryService.Result result = service(port).read(
                "tenant-a", "project-a", "2026-08", "request-a"
            );

            assertThat(result.authority().availability()).isEqualTo(availability);
            assertThat(result.operationalStatus()).isNull();
            assertThat(result.blockers()).anySatisfy(blocker -> {
                assertThat(blocker.code()).isEqualTo("CUMULATIVE_CLOSE_AUTHORITY_" + availability);
            });
        });
    }

    @Test
    void authorityProgrammingAndScopeErrorsAreNotHiddenAsAvailability() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
            .thenReturn(monthClose("project-a", "OPEN", 0, null, null));
        when(port.findCashflowCumulativeCloseHead("tenant-a", "project-a"))
            .thenThrow(new IllegalArgumentException("invalid project scope"));

        assertThatThrownBy(() -> service(port).read(
            "tenant-a", "project-a", "2026-08", "request-a"
        )).isInstanceOf(IllegalArgumentException.class)
            .hasMessage("invalid project scope");
    }

    @Test
    void oneLedgerReadFailureDoesNotRemoveIndependentOpeningAndSummarySections() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
            .thenReturn(monthClose(
                "project-a", "CLOSED", 1,
                "sha256:" + "a".repeat(64), "2026-08-01T00:00:00Z"
            ));
        when(port.findCashflowCumulativeCloseHead("tenant-a", "project-a"))
            .thenReturn(new CashflowCumulativeCloseHead(
                "CLOSED", "2023-01", "2026-08", "2026-07", "sha256:" + "b".repeat(64), 4
            ));
        when(port.findCashflowDeclaredWeeklyYear("tenant-a", "project-a")).thenReturn(2026);
        when(port.findCashflowLedgerSource("tenant-a", "project-a", 2026))
            .thenThrow(new CashflowReadPort.Unavailable(
                new IllegalStateException("Firestore internal path")
            ));
        when(port.findCashflowLedgerSource(
            "tenant-a", "project-a", 2026, "2023-01", "2026-08"
        )).thenReturn(new CashflowLedgerSource(List.of(), List.of()));
        when(port.findCashflowOpeningBalance("tenant-a", "project-a", 2026))
            .thenReturn(openingBalance());

        CashflowMonthDashboardQueryService.Result result = service(port).read(
            "tenant-a", "project-a", "2026-08", "request-a"
        );

        assertThat(result.operationalStatus()).isEqualTo("OPEN");
        assertThat(result.source()).isNull();
        assertThat(result.openingBalances().live()).isEqualTo(openingBalance());
        assertThat(result.projectionActualSummary()).isNotNull();
        assertThat(result.sectionErrors()).containsExactly(
            new CashflowMonthDashboardQueryService.SectionError(
                "cashflow", "cashflow_ledger_source_unavailable"
            )
        );
        assertThat(result.blockers()).contains(
            new CashflowMonthDashboardQueryService.Blocker("CASHFLOW_SOURCE_UNAVAILABLE")
        );
    }

    @Test
    void missingDeclaredWeeklyYearMakesCashflowAndSummaryUnavailableOnly() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
            .thenReturn(monthClose("project-a", "OPEN", 0, null, null));
        when(port.findCashflowCumulativeCloseHead("tenant-a", "project-a"))
            .thenReturn(new CashflowCumulativeCloseHead(
                "CLOSED", "2023-01", "2026-08", "2026-07", "sha256:" + "b".repeat(64), 4
            ));
        when(port.findCashflowDeclaredWeeklyYear("tenant-a", "project-a")).thenReturn(null);
        when(port.findCashflowOpeningBalance("tenant-a", "project-a", 2026))
            .thenReturn(openingBalance());

        CashflowMonthDashboardQueryService.Result result = service(port).read(
            "tenant-a", "project-a", "2026-08", "request-a"
        );

        assertThat(result.source()).isNull();
        assertThat(result.projectionActualSummary()).isNull();
        assertThat(result.openingBalances().live()).isEqualTo(openingBalance());
        assertThat(result.sectionErrors()).containsExactlyInAnyOrder(
            new CashflowMonthDashboardQueryService.SectionError(
                "cashflow", "cashflow_declared_weekly_year_missing"
            ),
            new CashflowMonthDashboardQueryService.SectionError(
                "projectionActualSummary", "cashflow_projection_actual_summary_unavailable"
            )
        );
        assertThat(result.blockers()).contains(
            new CashflowMonthDashboardQueryService.Blocker("SHEET_SOURCE_REQUIRED"),
            new CashflowMonthDashboardQueryService.Blocker("CASHFLOW_SOURCE_UNAVAILABLE"),
            new CashflowMonthDashboardQueryService.Blocker("PROJECTION_ACTUAL_SUMMARY_UNAVAILABLE")
        );
        verify(port, never()).findCashflowLedgerSource("tenant-a", "project-a", 2026);
    }

    @Test
    void missingLedgerSourceMakesCashflowAndSummaryUnavailableOnly() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
            .thenReturn(monthClose("project-a", "OPEN", 0, null, null));
        when(port.findCashflowCumulativeCloseHead("tenant-a", "project-a"))
            .thenReturn(new CashflowCumulativeCloseHead(
                "CLOSED", "2023-01", "2026-08", "2026-07", "sha256:" + "b".repeat(64), 4
            ));
        when(port.findCashflowDeclaredWeeklyYear("tenant-a", "project-a")).thenReturn(2026);
        when(port.findCashflowOpeningBalance("tenant-a", "project-a", 2026))
            .thenReturn(openingBalance());

        CashflowMonthDashboardQueryService.Result result = service(port).read(
            "tenant-a", "project-a", "2026-08", "request-a"
        );

        assertThat(result.source()).isNull();
        assertThat(result.projectionActualSummary()).isNull();
        assertThat(result.openingBalances().live()).isEqualTo(openingBalance());
        assertThat(result.sectionErrors()).containsExactlyInAnyOrder(
            new CashflowMonthDashboardQueryService.SectionError(
                "cashflow", "cashflow_ledger_source_unavailable"
            ),
            new CashflowMonthDashboardQueryService.SectionError(
                "projectionActualSummary", "cashflow_projection_actual_summary_unavailable"
            )
        );
        assertThat(result.blockers()).contains(
            new CashflowMonthDashboardQueryService.Blocker("CASHFLOW_SOURCE_UNAVAILABLE"),
            new CashflowMonthDashboardQueryService.Blocker("PROJECTION_ACTUAL_SUMMARY_UNAVAILABLE")
        );
    }

    @Test
    void sectionProgrammingAndBusinessErrorsNeverBecomeAvailability() {
        for (RuntimeException failure : List.of(
            new IllegalStateException("programming error"),
            new IllegalArgumentException("scope error")
        )) {
            CashflowReadPort port = mock(CashflowReadPort.class);
            when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
                .thenReturn(monthClose("project-a", "OPEN", 0, null, null));
            when(port.findCashflowCumulativeCloseHead("tenant-a", "project-a"))
                .thenReturn(new CashflowCumulativeCloseHead(
                    "CLOSED", "2023-01", "2026-08", "2026-07", "sha256:" + "b".repeat(64), 4
                ));
            when(port.findCashflowDeclaredWeeklyYear("tenant-a", "project-a"))
                .thenThrow(failure);

            assertThatThrownBy(() -> service(port).read(
                "tenant-a", "project-a", "2026-08", "request-a"
            )).isSameAs(failure);
        }
    }

    @Test
    void reopenRequestCapabilityUsesTheDomainLatestHorizonPolicy() {
        CashflowReadPort port = mock(CashflowReadPort.class);
        when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-08"))
            .thenReturn(monthClose(
                "project-a", "CLOSED", 1,
                "sha256:" + "a".repeat(64), "2026-08-31T15:00:00Z"
            ));
        when(port.findCashflowCumulativeCloseHead("tenant-a", "project-a"))
            .thenReturn(new CashflowCumulativeCloseHead(
                "CLOSED", "2023-01", "2026-08", "2026-07",
                "sha256:" + "b".repeat(64), 4
            ));

        CashflowMonthDashboardQueryService.Result eligible = service(port).read(
            "tenant-a", "project-a", "2026-08", "request-a"
        );

        assertThat(eligible.reopenRequest().enabled()).isTrue();
        assertThat(eligible.reopenRequest().reasonCode()).isEmpty();

        when(port.findCashflowMonthClose("tenant-a", "project-a", "2026-07"))
            .thenReturn(monthClose(
                "project-a", "CLOSED", 1,
                "sha256:" + "c".repeat(64), "2026-07-31T15:00:00Z"
            ));
        CashflowMonthDashboardQueryService.Result historical = service(port).read(
            "tenant-a", "project-a", "2026-07", "request-b"
        );

        assertThat(historical.reopenRequest().enabled()).isFalse();
        assertThat(historical.reopenRequest().reasonCode())
            .isEqualTo("CASHFLOW_MONTH_REOPEN_LATEST_HORIZON_ONLY");
    }

    private CashflowMonthDashboardQueryService service(CashflowReadPort port) {
        return new CashflowMonthDashboardQueryService(
            new CashflowReadService(port),
            new CashflowDashboardSectionQueryService(),
            CLOCK
        );
    }

    private CashflowMonthCloseState monthClose(
        String projectId,
        String status,
        long revision,
        String snapshotHash,
        String closedAt
    ) {
        return new CashflowMonthCloseState(
            projectId, "2026-08", status, revision, 0, 0, 0, 0,
            null, null, null, null, null, false, Map.of(),
            snapshotHash, null, Map.of(), Map.of(), false,
            "2026-08-14", "2026-09-10", false,
            closedAt, null, null, null, null, null, null, null, null, null, false
        );
    }

    private CashflowMonthCloseState monthCloseWithSnapshot(
        String projectId,
        Map<String, Object> snapshot
    ) {
        return new CashflowMonthCloseState(
            projectId, "2026-08", "OPEN", 0, 0, 0, 0, 0,
            null, null, null, null, null, false, Map.of(),
            null, null, snapshot, Map.of(), false,
            "2026-08-14", "2026-09-10", false,
            null, null, null, null, null, null, null, null, null, null, false
        );
    }

    private CashflowOpeningBalance openingBalance() {
        CashflowOpeningBalance.Mode empty = new CashflowOpeningBalance.Mode(
            BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of()
        );
        return new CashflowOpeningBalance(2026, empty, empty);
    }
}
