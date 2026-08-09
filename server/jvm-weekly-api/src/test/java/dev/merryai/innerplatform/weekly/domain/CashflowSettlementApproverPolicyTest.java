package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowSettlementApproverPolicyTest {

    @Test
    void onlyTheProjectsDesignatedExecutiveApproverCanApprove() {
        assertThat(CashflowSettlementApproverPolicy.isDesignatedApprover("executive-a", "executive-a")).isTrue();
        assertThat(CashflowSettlementApproverPolicy.isDesignatedApprover("executive-a", "finance-admin")).isFalse();
    }

    @Test
    void nobodyCanApproveWhenNoApproverIsDesignated() {
        assertThat(CashflowSettlementApproverPolicy.isDesignatedApprover(null, "executive-a")).isFalse();
        assertThat(CashflowSettlementApproverPolicy.isDesignatedApprover("", "executive-a")).isFalse();
    }

    @Test
    void blankActorNeverMatches() {
        assertThat(CashflowSettlementApproverPolicy.isDesignatedApprover("executive-a", null)).isFalse();
        assertThat(CashflowSettlementApproverPolicy.isDesignatedApprover("executive-a", " ")).isFalse();
        // 저장값 비교는 트리밍 없이 그대로다 - 영속 계층의 기존 판정과 동일.
        assertThat(CashflowSettlementApproverPolicy.isDesignatedApprover(" executive-a ", "executive-a")).isFalse();
    }
}
