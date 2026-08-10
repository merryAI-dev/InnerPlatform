package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import static dev.merryai.innerplatform.weekly.domain.CashflowMonthReopenApprovalPolicy.Decision.ALLOWED;
import static dev.merryai.innerplatform.weekly.domain.CashflowMonthReopenApprovalPolicy.Decision.LEGACY_REQUESTER_MISSING;
import static org.assertj.core.api.Assertions.assertThat;

class CashflowMonthReopenApprovalPolicyTest {
    @Test
    void allowsTheRequesterToDecideTheirOwnReopenRequest() {
        assertThat(CashflowMonthReopenApprovalPolicy.decide("user-a", "user-a"))
            .isEqualTo(ALLOWED);
        assertThat(CashflowMonthReopenApprovalPolicy.decide("user-a", "user-b"))
            .isEqualTo(ALLOWED);
        assertThat(CashflowMonthReopenApprovalPolicy.decide("Admin", "admin"))
            .isEqualTo(ALLOWED);
        assertThat(CashflowMonthReopenApprovalPolicy.decide("user-a ", "user-a"))
            .isEqualTo(ALLOWED);
    }

    @Test
    void identifiesMissingLegacyRequesterValues() {
        assertThat(CashflowMonthReopenApprovalPolicy.decide(null, "admin"))
            .isEqualTo(LEGACY_REQUESTER_MISSING);
        assertThat(CashflowMonthReopenApprovalPolicy.decide("", "admin"))
            .isEqualTo(LEGACY_REQUESTER_MISSING);
        assertThat(CashflowMonthReopenApprovalPolicy.decide("   ", "admin"))
            .isEqualTo(LEGACY_REQUESTER_MISSING);
    }

    @Test
    void comparesUntrustedUidTextWithoutParsingOrLengthLimits() {
        assertThat(CashflowMonthReopenApprovalPolicy.decide("__proto__", "__proto__"))
            .isEqualTo(ALLOWED);
        String longUid = "x".repeat(100_000);
        for (int index = 0; index < 1_000; index++) {
            assertThat(CashflowMonthReopenApprovalPolicy.decide(longUid, longUid))
                .isEqualTo(ALLOWED);
        }
    }
}
