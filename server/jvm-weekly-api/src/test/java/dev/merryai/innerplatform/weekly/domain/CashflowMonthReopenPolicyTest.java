package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CashflowMonthReopenPolicyTest {

    @Test
    void decisionAuthorityAllowsOnlyTheExactActiveOrganizationHeadOrRuntimeAdmin() {
        CashflowMonthReopenPolicy.DecisionAuthority designatedViewer =
            CashflowMonthReopenPolicy.requireDecisionAuthority(authorityFacts(
                "tenant-a", "head-1", "project-a",
                true, "tenant-a", "project-a",
                "head-1", "ACTIVE", "viewer", "head-1"
            ));
        CashflowMonthReopenPolicy.DecisionAuthority runtimeAdmin =
            CashflowMonthReopenPolicy.requireDecisionAuthority(authorityFacts(
                "tenant-a", "admin-1", "project-a",
                true, "tenant-a", "project-a",
                "admin-1", "ACTIVE", "admin", "someone-else"
            ));

        assertThat(designatedViewer.storedRole()).isEqualTo("viewer");
        assertThat(runtimeAdmin.storedRole()).isEqualTo("admin");

        for (CashflowMonthReopenPolicy.DecisionAuthorityFacts denied : java.util.List.of(
            authorityFacts(
                "tenant-a", "head-1", "project-a",
                true, "tenant-a", "project-a",
                "head-1", "INACTIVE", "viewer", "head-1"
            ),
            authorityFacts(
                "tenant-a", "viewer-1", "project-a",
                true, "tenant-a", "project-a",
                "viewer-1", "ACTIVE", "viewer", "head-1"
            ),
            authorityFacts(
                "tenant-a", "head-1", "project-a",
                true, "tenant-a", "another-project",
                "head-1", "ACTIVE", "viewer", "head-1"
            ),
            authorityFacts(
                "tenant-a", "head-1", "project-a",
                true, "another-tenant", "project-a",
                "head-1", "ACTIVE", "viewer", "head-1"
            ),
            authorityFacts(
                "tenant-a", "head-1", "project-a",
                false, "tenant-a", "project-a",
                "head-1", "ACTIVE", "viewer", "head-1"
            )
        )) {
            assertViolation(
                () -> CashflowMonthReopenPolicy.requireDecisionAuthority(denied),
                CashflowMonthReopenPolicy.ViolationReason.DECISION_FORBIDDEN
            );
        }
    }

    @Test
    void requestOwnsLatestHorizonStatusAndRevisionInvariants() {
        CashflowMonthReopenPolicy.Facts facts = facts(
            true, "2026-08", "2026-07", 4,
            true, CashflowMonthReopenPolicy.State.CLOSED, 2, 1, 6, "requester-1"
        );

        assertViolation(
            () -> CashflowMonthReopenPolicy.request(facts, "2026-07", 2),
            CashflowMonthReopenPolicy.ViolationReason.LATEST_HORIZON_ONLY
        );
        assertViolation(
            () -> CashflowMonthReopenPolicy.request(
                facts(false, "", "", 0,
                    true, CashflowMonthReopenPolicy.State.OPEN, 2, 1, 6, "requester-1"),
                "2026-08",
                2
            ),
            CashflowMonthReopenPolicy.ViolationReason.MONTH_NOT_CLOSED
        );
        assertViolation(
            () -> CashflowMonthReopenPolicy.request(facts, "2026-08", 1),
            CashflowMonthReopenPolicy.ViolationReason.REVISION_CHANGED
        );

        CashflowMonthReopenPolicy.RequestTransition transition =
            CashflowMonthReopenPolicy.request(facts, "2026-08", 2);

        assertThat(transition.yearMonth()).isEqualTo("2026-08");
        assertThat(transition.nextMonthState()).isEqualTo(CashflowMonthReopenPolicy.State.REOPEN_REQUESTED);
        assertThat(transition.nextMonthRevision()).isEqualTo(3);
    }

    @Test
    void approvalRestoresTheExactPreApprovalAuthorityAcrossACatchUpRange() {
        CashflowMonthReopenPolicy.Facts facts = cumulativeFacts(
            true, "2026-08", "2026-07", 5,
            true, CashflowMonthReopenPolicy.State.REOPEN_REQUESTED, 3, 1, 6, "requester-1",
            true, "2026-06", "2026-05", "2026-06", "2026-07", "project-a-2026-08-r1"
        );

        CashflowMonthReopenPolicy.DecisionTransition transition = CashflowMonthReopenPolicy.decide(
            facts,
            "2026-08",
            3,
            CashflowMonthReopenPolicy.Decision.APPROVE
        );

        assertThat(transition.nextMonthState()).isEqualTo(CashflowMonthReopenPolicy.State.OPEN);
        assertThat(transition.nextMonthRevision()).isEqualTo(4);
        assertThat(transition.nextReopenCount()).isEqualTo(2);
        assertThat(transition.nextProjectWarningCount()).isEqualTo(7);
        assertThat(transition.dataYearMonth()).isEqualTo("2026-07");
        assertThat(transition.nextHeadState()).isEqualTo(CashflowMonthReopenPolicy.State.CLOSED);
        assertThat(transition.nextHeadRevision()).isEqualTo(6);
        assertThat(transition.nextClosedThrough()).isEqualTo("2026-05");
        assertThat(transition.nextSettlementMonth()).isEqualTo("2026-06");
        assertThat(transition.previousAuthorityExists()).isTrue();
        assertThat(transition.affectedFromMonth()).isEqualTo("2026-06");
        assertThat(transition.affectedThroughMonth()).isEqualTo("2026-07");
        assertThat(transition.approvalVersionId()).isEqualTo("project-a-2026-08-r1");
        assertThat(transition.legacyRequesterMissing()).isFalse();
        assertThat(transition.updatesHeadAuthority()).isTrue();
    }

    @Test
    void firstApprovalReopenProducesAnExplicitAuthorityTombstone() {
        CashflowMonthReopenPolicy.Facts facts = cumulativeFacts(
            true, "2026-08", "2026-07", 1,
            true, CashflowMonthReopenPolicy.State.REOPEN_REQUESTED, 2, 0, 0, "requester-1",
            false, "", "", "2026-01", "2026-07", "project-a-2026-08-r1"
        );

        CashflowMonthReopenPolicy.DecisionTransition transition = CashflowMonthReopenPolicy.decide(
            facts,
            "2026-08",
            2,
            CashflowMonthReopenPolicy.Decision.APPROVE
        );

        assertThat(transition.previousAuthorityExists()).isFalse();
        assertThat(transition.nextHeadState()).isEqualTo(CashflowMonthReopenPolicy.State.OPEN);
        assertThat(transition.nextHeadRevision()).isEqualTo(2);
        assertThat(transition.nextClosedThrough()).isEmpty();
        assertThat(transition.nextSettlementMonth()).isEmpty();
    }

    @Test
    void legacyApprovalPreservesThePreCycleOneMonthRollbackWithoutV3Evidence() {
        CashflowMonthReopenPolicy.Facts facts = facts(
            true, "2026-07", "2026-06", 1,
            true, CashflowMonthReopenPolicy.State.REOPEN_REQUESTED, 2, 0, 0, "requester-1"
        );

        CashflowMonthReopenPolicy.DecisionTransition transition = CashflowMonthReopenPolicy.decideLegacy(
            facts,
            "2026-07",
            2,
            CashflowMonthReopenPolicy.Decision.APPROVE
        );

        assertThat(transition.nextMonthState()).isEqualTo(CashflowMonthReopenPolicy.State.OPEN);
        assertThat(transition.nextMonthRevision()).isEqualTo(3);
        assertThat(transition.dataYearMonth()).isEqualTo("2026-06");
        assertThat(transition.nextHeadState()).isEqualTo(CashflowMonthReopenPolicy.State.CLOSED);
        assertThat(transition.nextHeadRevision()).isEqualTo(2);
        assertThat(transition.nextClosedThrough()).isEqualTo("2026-05");
        assertThat(transition.nextSettlementMonth()).isEqualTo("2026-06");
        assertThat(transition.approvalVersionId()).isEmpty();
    }

    @Test
    void rejectionClosesTheRequestWithoutChangingCountersOrCumulativeHorizon() {
        CashflowMonthReopenPolicy.Facts facts = facts(
            true, "2026-08", "2026-08", 5,
            true, CashflowMonthReopenPolicy.State.REOPEN_REQUESTED, 3, 1, 6, ""
        );

        CashflowMonthReopenPolicy.DecisionTransition transition = CashflowMonthReopenPolicy.decide(
            facts,
            "2026-08",
            3,
            CashflowMonthReopenPolicy.Decision.REJECT
        );

        assertThat(transition.nextMonthState()).isEqualTo(CashflowMonthReopenPolicy.State.CLOSED);
        assertThat(transition.nextReopenCount()).isEqualTo(1);
        assertThat(transition.nextProjectWarningCount()).isEqualTo(6);
        assertThat(transition.nextClosedThrough()).isEmpty();
        assertThat(transition.nextSettlementMonth()).isEmpty();
        assertThat(transition.legacyRequesterMissing()).isTrue();
        assertThat(transition.updatesHeadAuthority()).isFalse();
        assertThat(transition.nextHeadRevision()).isEqualTo(5);
    }

    @Test
    void decisionRejectsMissingRequestWrongStatusRevisionAndCounterOverflow() {
        CashflowMonthReopenPolicy.Facts valid = facts(
            false, "", "", 0,
            true, CashflowMonthReopenPolicy.State.REOPEN_REQUESTED, 3, 1, 6, "requester-1"
        );
        assertViolation(
            () -> CashflowMonthReopenPolicy.decide(
                facts(false, "", "", 0,
                    false, CashflowMonthReopenPolicy.State.UNKNOWN, 0, 0, 0, ""),
                "2026-08", 0, CashflowMonthReopenPolicy.Decision.APPROVE
            ),
            CashflowMonthReopenPolicy.ViolationReason.REQUEST_MISSING
        );
        assertViolation(
            () -> CashflowMonthReopenPolicy.decide(
                facts(false, "", "", 0,
                    true, CashflowMonthReopenPolicy.State.CLOSED, 3, 1, 6, "requester-1"),
                "2026-08", 3, CashflowMonthReopenPolicy.Decision.APPROVE
            ),
            CashflowMonthReopenPolicy.ViolationReason.NOT_AWAITING_DECISION
        );
        assertViolation(
            () -> CashflowMonthReopenPolicy.decide(
                valid, "2026-08", 2, CashflowMonthReopenPolicy.Decision.APPROVE
            ),
            CashflowMonthReopenPolicy.ViolationReason.REVISION_CHANGED
        );
        assertViolation(
            () -> CashflowMonthReopenPolicy.decide(
                facts(false, "", "", 0,
                    true, CashflowMonthReopenPolicy.State.REOPEN_REQUESTED, 3,
                    Long.MAX_VALUE, 6, "requester-1"),
                "2026-08", 3, CashflowMonthReopenPolicy.Decision.APPROVE
            ),
            CashflowMonthReopenPolicy.ViolationReason.COUNTER_OUT_OF_RANGE
        );
    }

    private static CashflowMonthReopenPolicy.Facts facts(
        boolean cumulative,
        String settlementMonth,
        String closedThrough,
        long headRevision,
        boolean monthExists,
        CashflowMonthReopenPolicy.State monthState,
        long monthRevision,
        long reopenCount,
        long projectWarningCount,
        String requestedByUid
    ) {
        return new CashflowMonthReopenPolicy.Facts(
            cumulative,
            settlementMonth,
            closedThrough,
            headRevision,
            monthExists,
            monthState,
            monthRevision,
            reopenCount,
            projectWarningCount,
            requestedByUid
        );
    }

    private static CashflowMonthReopenPolicy.Facts cumulativeFacts(
        boolean cumulative,
        String settlementMonth,
        String closedThrough,
        long headRevision,
        boolean monthExists,
        CashflowMonthReopenPolicy.State monthState,
        long monthRevision,
        long reopenCount,
        long projectWarningCount,
        String requestedByUid,
        boolean previousAuthorityExists,
        String previousSettlementMonth,
        String previousClosedThrough,
        String affectedFromMonth,
        String affectedThroughMonth,
        String approvalVersionId
    ) {
        return new CashflowMonthReopenPolicy.Facts(
            cumulative,
            settlementMonth,
            closedThrough,
            headRevision,
            monthExists,
            monthState,
            monthRevision,
            reopenCount,
            projectWarningCount,
            requestedByUid,
            previousAuthorityExists,
            previousSettlementMonth,
            previousClosedThrough,
            affectedFromMonth,
            affectedThroughMonth,
            approvalVersionId
        );
    }

    private static CashflowMonthReopenPolicy.DecisionAuthorityFacts authorityFacts(
        String actorTenantId,
        String actorUid,
        String requestedProjectId,
        boolean projectExists,
        String projectTenantId,
        String storedProjectId,
        String memberUid,
        String memberStatus,
        String storedRole,
        String executiveApproverUid
    ) {
        return new CashflowMonthReopenPolicy.DecisionAuthorityFacts(
            actorTenantId,
            actorUid,
            requestedProjectId,
            projectExists,
            projectTenantId,
            storedProjectId,
            memberUid,
            memberStatus,
            storedRole,
            executiveApproverUid,
            1
        );
    }

    private static void assertViolation(
        Runnable action,
        CashflowMonthReopenPolicy.ViolationReason reason
    ) {
        assertThatThrownBy(action::run)
            .isInstanceOf(CashflowMonthReopenPolicy.Violation.class)
            .satisfies(error -> assertThat(((CashflowMonthReopenPolicy.Violation) error).reason())
                .isEqualTo(reason));
    }
}
