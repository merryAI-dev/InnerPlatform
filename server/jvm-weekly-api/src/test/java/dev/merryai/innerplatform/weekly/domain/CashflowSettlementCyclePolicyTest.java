package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CashflowSettlementCyclePolicyTest {

    @Test
    void cycleKeepsCurrentMonthWeeksAndTargetsThePreviousMonthCloseAcrossYearBoundary() {
        assertThat(CashflowSettlementCyclePolicy.identity("2026-09"))
            .isEqualTo(new CashflowSettlementCyclePolicy.Identity("2026-09", "2026-09", "2026-08"));
        assertThat(CashflowSettlementCyclePolicy.identity("2027-01"))
            .isEqualTo(new CashflowSettlementCyclePolicy.Identity("2027-01", "2027-01", "2026-12"));
    }

    @Test
    void canonicalDocumentsResolveToOneMonthCloseLifecycle() {
        assertThat(resolve("", "OPEN", "WAITING_FOR_UPDATE")).isEqualTo("NOT_REQUESTED");
        assertThat(resolve("", "CLOSED", "COMPLETED")).isEqualTo("APPROVED");
        assertThat(resolve("PENDING", "OPEN", "PENDING_APPROVAL")).isEqualTo("PENDING_APPROVAL");
        assertThat(resolve("PENDING", "OPEN", "SUBMITTED")).isEqualTo("PENDING_APPROVAL");
        assertThat(resolve("APPROVING", "OPEN", "PENDING_APPROVAL")).isEqualTo("APPROVING");
        assertThat(resolve("APPROVED", "CLOSED", "COMPLETED")).isEqualTo("APPROVED");
        assertThat(resolve("APPROVED", "CLOSED", "LOCKED")).isEqualTo("APPROVED");
        assertThat(resolve("REOPEN_REQUESTED", "REOPEN_REQUESTED", "COMPLETED")).isEqualTo("REOPEN_REQUESTED");
        assertThat(resolve("REOPEN_REQUESTED", "REOPEN_REQUESTED", "LOCKED")).isEqualTo("REOPEN_REQUESTED");
        assertThat(resolve("REOPENED", "OPEN", "WAITING_FOR_UPDATE")).isEqualTo("REOPENED");
        assertThat(resolve("REJECTED", "OPEN", "WAITING_FOR_UPDATE")).isEqualTo("REJECTED");
        assertThat(resolve("WITHDRAWN", "OPEN", "WAITING_FOR_UPDATE")).isEqualTo("WITHDRAWN");
        assertThat(resolve("UNCERTAIN", "CLOSED", "COMPLETED")).isEqualTo("UNCERTAIN");
    }

    @Test
    void contradictoryOrUnknownDocumentsFailClosed() {
        assertThat(resolve("APPROVED", "OPEN", "COMPLETED")).isEqualTo("INCONSISTENT");
        assertThat(resolve("PENDING", "CLOSED", "PENDING_APPROVAL")).isEqualTo("INCONSISTENT");
        assertThat(resolve("REOPENED", "CLOSED", "COMPLETED")).isEqualTo("INCONSISTENT");
        assertThat(resolve("UNKNOWN", "OPEN", "WAITING_FOR_UPDATE")).isEqualTo("INCONSISTENT");
        assertThat(resolve("", "OPEN", "COMPLETED")).isEqualTo("INCONSISTENT");
    }

    @Test
    void generalSettlementTransitionAcceptsWeeksAndRejectsMonth() {
        assertThat(CashflowSettlementCyclePolicy.requireWeeklyTransitionPeriod("WEEK_1")).isEqualTo("WEEK_1");
        assertThat(CashflowSettlementCyclePolicy.requireWeeklyTransitionPeriod("WEEK_5")).isEqualTo("WEEK_5");
        assertThatThrownBy(() -> CashflowSettlementCyclePolicy.requireWeeklyTransitionPeriod("MONTH"))
            .isInstanceOf(CashflowSettlementCyclePolicy.Violation.class)
            .satisfies(error -> assertThat(((CashflowSettlementCyclePolicy.Violation) error).reason())
                .isEqualTo(CashflowSettlementCyclePolicy.ViolationReason.MONTH_REQUIRES_CLOSE_WORKFLOW));
    }

    @Test
    void verifiedCatchUpRangeProjectsIntermediateCyclesAsApproved() {
        CashflowSettlementCyclePolicy.ApprovalProvenance provenance = provenance(
            "2026-06", "2026-08", "2026-09", "approval-v7", "project-a-2026-09"
        );

        CashflowSettlementCyclePolicy.Projection projection = CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                false, "", 0, "", "WAITING_FOR_UPDATE", true, provenance
            )
        );

        assertThat(projection.businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.LOCKED);
        assertThat(projection.health()).isEqualTo(CashflowSettlementCyclePolicy.Health.OK);
        assertThat(projection.provenance()).isEqualTo(provenance);
        assertThat(projection.supersededAttempt()).isEmpty();
    }

    @Test
    void closedHeadWithoutVerifiedImmutableRangeFailsClosed() {
        CashflowSettlementCyclePolicy.Projection projection = CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                false, "", 0, "", "WAITING_FOR_UPDATE", true, null
            )
        );

        assertThat(projection.businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
        assertThat(projection.health()).isEqualTo(CashflowSettlementCyclePolicy.Health.OK);
        assertThat(projection.provenance()).isNull();
    }

    @Test
    void newerVerifiedCatchUpApprovalSupersedesARejectedOrWithdrawnAttempt() {
        for (String attempt : new String[] {"REJECTED", "WITHDRAWN"}) {
            CashflowSettlementCyclePolicy.Projection projection = CashflowSettlementCyclePolicy.project(
                new CashflowSettlementCyclePolicy.ProjectionFacts(
                    true, attempt, 4, "OPEN", "WAITING_FOR_UPDATE", true,
                    provenance("2026-06", "2026-08", "2026-09", "approval-v7", "project-a-2026-09")
                )
            );

            assertThat(projection.businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.LOCKED);
            assertThat(projection.workflowRevision()).isEqualTo(4);
            assertThat(projection.supersededAttempt()).isEqualTo(attempt);
        }
    }

    @Test
    void canonicalRequestStatesRequireMatchingLedgerSettlementAndApprovalEvidence() {
        assertThat(project("PENDING", 2, "OPEN", "SUBMITTED", false, null).businessState())
            .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.SUBMITTED);
        assertThat(project("APPROVED", 3, "CLOSED", "LOCKED", true,
            provenance("2026-08", "2026-08", "2026-09", "approval-v3", "project-a-2026-09")).businessState())
            .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.LOCKED);
        assertThat(project("APPROVED", 3, "CLOSED", "LOCKED", true, null).businessState())
            .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
        assertThat(project("REOPEN_REQUESTED", 4, "REOPEN_REQUESTED", "LOCKED", true,
            provenance("2026-08", "2026-08", "2026-09", "approval-v3", "project-a-2026-09")).businessState())
            .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.REOPEN_REQUESTED);
        assertThat(project("REOPENED", 5, "OPEN", "WAITING_FOR_UPDATE", false, null).businessState())
            .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.REOPENED);
    }

    @Test
    void historicalMonthStatesProjectToTheCanonicalBusinessVocabularyWithoutMutation() {
        assertThat(project("PENDING", 2, "OPEN", "PENDING_APPROVAL", false, null)
            .businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.SUBMITTED);
        assertThat(project("APPROVED", 3, "CLOSED", "COMPLETED", true,
            provenance("2026-08", "2026-08", "2026-09", "approval-v3", "project-a-2026-09"))
            .businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.LOCKED);
    }

    @Test
    void legacyTransportStatesAreHealthNotNewBusinessStates() {
        assertThat(project("BUILDING", 0, "OPEN", "WAITING_FOR_UPDATE", false, null))
            .isEqualTo(new CashflowSettlementCyclePolicy.Projection(
                CashflowSettlementCyclePolicy.BusinessState.NOT_REQUESTED,
                CashflowSettlementCyclePolicy.Health.RECONCILING,
                0,
                null,
                ""
            ));
        assertThat(project("APPROVING", 2, "OPEN", "SUBMITTED", false, null).businessState())
            .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.SUBMITTED);
        assertThat(project("APPROVING", 2, "OPEN", "SUBMITTED", false, null).health())
            .isEqualTo(CashflowSettlementCyclePolicy.Health.RECONCILING);
        assertThat(project("UNCERTAIN", 2, "CLOSED", "LOCKED", true,
            provenance("2026-08", "2026-08", "2026-09", "approval-v3", "project-a-2026-09")).businessState())
            .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.LOCKED);
        assertThat(project("UNCERTAIN", 2, "CLOSED", "LOCKED", true,
            provenance("2026-08", "2026-08", "2026-09", "approval-v3", "project-a-2026-09")).health())
            .isEqualTo(CashflowSettlementCyclePolicy.Health.RECONCILING);
    }

    @Test
    void commandCapabilitiesAreOwnedByTheCanonicalProjectionAndActorAuthority() {
        CashflowSettlementCyclePolicy.Projection pending = project(
            "PENDING", 2, "OPEN", "SUBMITTED", false, null
        );
        Map<CashflowSettlementCyclePolicy.Command, CashflowSettlementCyclePolicy.CommandCapability>
            requesterCapabilities = CashflowSettlementCyclePolicy.commandCapabilities(
                new CashflowSettlementCyclePolicy.CapabilityFacts(
                    pending, false, true, true, false, true, false
                )
            );
        assertThat(requesterCapabilities.get(CashflowSettlementCyclePolicy.Command.WITHDRAW_MONTH_CLOSE))
            .isEqualTo(new CashflowSettlementCyclePolicy.CommandCapability(true, ""));
        assertThat(requesterCapabilities.get(CashflowSettlementCyclePolicy.Command.APPROVE_MONTH_CLOSE))
            .isEqualTo(new CashflowSettlementCyclePolicy.CommandCapability(false, "NOT_CURRENT_APPROVER"));

        Map<CashflowSettlementCyclePolicy.Command, CashflowSettlementCyclePolicy.CommandCapability>
            approverCapabilities = CashflowSettlementCyclePolicy.commandCapabilities(
                new CashflowSettlementCyclePolicy.CapabilityFacts(
                    pending, false, true, true, true, false, false
                )
            );
        assertThat(approverCapabilities.get(CashflowSettlementCyclePolicy.Command.APPROVE_MONTH_CLOSE).allowed())
            .isTrue();
        assertThat(approverCapabilities.get(CashflowSettlementCyclePolicy.Command.REJECT_MONTH_CLOSE).allowed())
            .isTrue();
        assertThat(approverCapabilities.get(CashflowSettlementCyclePolicy.Command.WITHDRAW_MONTH_CLOSE).reasonCode())
            .isEqualTo("NOT_REQUESTER");
    }

    @Test
    void capabilitiesCoverSubmitReopenAndAdminRecoveryWithoutInventingActions() {
        assertThat(allowedCommands(capabilityFacts(
            CashflowSettlementCyclePolicy.BusinessState.NOT_REQUESTED, true, true, false, false, false
        ))).containsExactly(CashflowSettlementCyclePolicy.Command.SUBMIT_MONTH_CLOSE);

        assertThat(allowedCommands(capabilityFacts(
            CashflowSettlementCyclePolicy.BusinessState.LOCKED, true, true, false, false, false
        ))).containsExactly(CashflowSettlementCyclePolicy.Command.REQUEST_MONTH_REOPEN);

        assertThat(allowedCommands(capabilityFacts(
            CashflowSettlementCyclePolicy.BusinessState.REOPEN_REQUESTED, true, true, true, false, false
        ))).containsExactly(
            CashflowSettlementCyclePolicy.Command.APPROVE_MONTH_REOPEN,
            CashflowSettlementCyclePolicy.Command.REJECT_MONTH_REOPEN
        );

        assertThat(allowedCommands(capabilityFacts(
            CashflowSettlementCyclePolicy.BusinessState.REOPENED, true, true, false, false, true
        ))).containsExactly(
            CashflowSettlementCyclePolicy.Command.SUBMIT_MONTH_CLOSE,
            CashflowSettlementCyclePolicy.Command.CANCEL_ACTIVE_CYCLE
        );
    }

    @Test
    void legacyUnhealthyOrInactiveReadsFailClosedForEveryCommand() {
        CashflowSettlementCyclePolicy.Projection approved = new CashflowSettlementCyclePolicy.Projection(
            CashflowSettlementCyclePolicy.BusinessState.LOCKED,
            CashflowSettlementCyclePolicy.Health.OK,
            3,
            provenance("2026-08", "2026-08", "2026-09", "approval-v3", "project-a-2026-09"),
            ""
        );
        assertAllDenied(
            CashflowSettlementCyclePolicy.commandCapabilities(
                new CashflowSettlementCyclePolicy.CapabilityFacts(
                    approved, true, true, true, false, false, false
                )
            ),
            "LEGACY_READ_ONLY"
        );
        assertAllDenied(
            CashflowSettlementCyclePolicy.commandCapabilities(
                new CashflowSettlementCyclePolicy.CapabilityFacts(
                    new CashflowSettlementCyclePolicy.Projection(
                        approved.businessState(), CashflowSettlementCyclePolicy.Health.RECONCILING,
                        approved.workflowRevision(), approved.provenance(), ""
                    ),
                    false, true, true, false, false, false
                )
            ),
            "PROJECTION_NOT_READY"
        );
        assertAllDenied(
            CashflowSettlementCyclePolicy.commandCapabilities(
                new CashflowSettlementCyclePolicy.CapabilityFacts(
                    approved, false, false, false, false, false, false
                )
            ),
            "ACTOR_INACTIVE"
        );
    }

    private static CashflowSettlementCyclePolicy.CapabilityFacts capabilityFacts(
        CashflowSettlementCyclePolicy.BusinessState state,
        boolean activeMember,
        boolean projectWriter,
        boolean currentApprover,
        boolean requester,
        boolean recoveryAdmin
    ) {
        return new CashflowSettlementCyclePolicy.CapabilityFacts(
            new CashflowSettlementCyclePolicy.Projection(
                state, CashflowSettlementCyclePolicy.Health.OK, 1, null, ""
            ),
            false,
            activeMember,
            projectWriter,
            currentApprover,
            requester,
            recoveryAdmin
        );
    }

    private static java.util.List<CashflowSettlementCyclePolicy.Command> allowedCommands(
        CashflowSettlementCyclePolicy.CapabilityFacts facts
    ) {
        return CashflowSettlementCyclePolicy.commandCapabilities(facts).entrySet().stream()
            .filter(entry -> entry.getValue().allowed())
            .map(Map.Entry::getKey)
            .toList();
    }

    private static void assertAllDenied(
        Map<CashflowSettlementCyclePolicy.Command, CashflowSettlementCyclePolicy.CommandCapability> capabilities,
        String reasonCode
    ) {
        assertThat(capabilities).hasSize(CashflowSettlementCyclePolicy.Command.values().length);
        assertThat(capabilities.values()).allSatisfy(capability -> {
            assertThat(capability.allowed()).isFalse();
            assertThat(capability.reasonCode()).isEqualTo(reasonCode);
        });
    }

    private static String resolve(String requestStatus, String ledgerStatus, String settlementStatus) {
        return CashflowSettlementCyclePolicy.resolveMonthCloseLifecycle(
            new CashflowSettlementCyclePolicy.MonthCloseFacts(requestStatus, ledgerStatus, settlementStatus)
        ).name();
    }

    private static CashflowSettlementCyclePolicy.Projection project(
        String requestStatus,
        long workflowRevision,
        String ledgerStatus,
        String settlementStatus,
        boolean headClaimsTargetClosed,
        CashflowSettlementCyclePolicy.ApprovalProvenance provenance
    ) {
        return CashflowSettlementCyclePolicy.project(new CashflowSettlementCyclePolicy.ProjectionFacts(
            true,
            requestStatus,
            workflowRevision,
            ledgerStatus,
            settlementStatus,
            headClaimsTargetClosed,
            provenance
        ));
    }

    private static CashflowSettlementCyclePolicy.ApprovalProvenance provenance(
        String fromMonth,
        String throughMonth,
        String closedByCycleYearMonth,
        String approvalVersionId,
        String requestId
    ) {
        return new CashflowSettlementCyclePolicy.ApprovalProvenance(
            fromMonth,
            throughMonth,
            closedByCycleYearMonth,
            approvalVersionId,
            requestId,
            7,
            "root-hash"
        );
    }
}
