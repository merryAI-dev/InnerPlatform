package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowMonthAuthorityTest {

    @Test
    void cumulativeAuthorityClosesOnlyMonthsInItsOwnYear() {
        CashflowCumulativeCloseHead head = new CashflowCumulativeCloseHead(
            "CLOSED", "2023-01", "2026-08", "2026-07", "sha256:" + "a".repeat(64), 1
        );

        assertThat(head.operationalStatus("2026-07")).isEqualTo("CLOSED");
        assertThat(head.operationalStatus("2025-12")).isEqualTo("OPEN");
    }

    @Test
    void januarySettlementDoesNotTurnThePreviousAnnualYearIntoMonthlyAuthority() {
        CashflowCumulativeCloseHead head = new CashflowCumulativeCloseHead(
            "CLOSED", "2023-01", "2026-01", "2025-12", "sha256:" + "a".repeat(64), 1
        );

        assertThat(head.operationalStatus("2025-12")).isEqualTo("OPEN");
        assertThat(head.operationalStatus("2026-01")).isEqualTo("OPEN");
    }

    @Test
    void historicalOpenEvidenceIsNotPristine() {
        CashflowMonthCloseState state = openState(Map.of("version", 1));

        assertThat(state.isPristineOpen()).isFalse();
    }

    private CashflowMonthCloseState openState(Map<String, Object> snapshot) {
        return new CashflowMonthCloseState(
            "project-a", "2026-08", "OPEN", 0, 0, 0, 0, 0,
            null, null, null, null, null, false, Map.of(),
            null, null, snapshot, Map.of(), false,
            "2026-08-14", "2026-09-10", false,
            null, null, null, null, null, null, null, null, null, null, false
        );
    }
}
