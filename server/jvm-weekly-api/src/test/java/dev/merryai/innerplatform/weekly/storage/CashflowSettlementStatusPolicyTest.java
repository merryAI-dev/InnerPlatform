package dev.merryai.innerplatform.weekly.storage;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowSettlementStatusPolicyTest {
    @Test
    void onlyTheProjectsDesignatedExecutiveApproverCanApprove() {
        Map<String, Object> project = Map.of("executiveApproverId", "executive-a");

        assertThat(FirestoreInheritedWeeklyExpensePersistence.isDesignatedCashflowSettlementApprover(
            project, "executive-a"
        )).isTrue();
        assertThat(FirestoreInheritedWeeklyExpensePersistence.isDesignatedCashflowSettlementApprover(
            project, "finance-admin"
        )).isFalse();
    }

    @Test
    void completedStatusNeedsApprovalWhenValuesChangeAndRecoversWhenRestored() {
        assertThat(FirestoreInheritedWeeklyExpensePersistence.effectiveSettlementStatus(
            "COMPLETED", "revision-a", "revision-b"
        )).isEqualTo("PENDING_APPROVAL");
        assertThat(FirestoreInheritedWeeklyExpensePersistence.effectiveSettlementStatus(
            "COMPLETED", "revision-a", "revision-a"
        )).isEqualTo("COMPLETED");
        assertThat(FirestoreInheritedWeeklyExpensePersistence.effectiveSettlementStatus(
            "WAITING_FOR_UPDATE", "", "revision-a"
        )).isEqualTo("WAITING_FOR_UPDATE");
    }
}
