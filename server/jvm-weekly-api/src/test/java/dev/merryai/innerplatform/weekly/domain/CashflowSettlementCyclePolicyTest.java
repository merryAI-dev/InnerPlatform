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
                false, "", 0, "OPEN", "WAITING_FOR_UPDATE", true, provenance, false
            )
        );

        assertThat(projection.businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.LOCKED);
        assertThat(projection.health()).isEqualTo(CashflowSettlementCyclePolicy.Health.OK);
        assertThat(projection.provenance()).isEqualTo(provenance);
        assertThat(projection.supersededAttempt()).isEmpty();
    }

    @Test
    void noAttemptRequiresTheOpenWaitingCanonicalMonthState() {
        assertThat(CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                false, "", 0, "OPEN", "LOCKED", false, null, false
            )
        ).businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
        assertThat(CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                false, "", 0, "CLOSED", "WAITING_FOR_UPDATE", false, null, false
            )
        ).businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
    }

    @Test
    void closedHeadWithoutVerifiedImmutableRangeFailsClosed() {
        CashflowSettlementCyclePolicy.Projection projection = CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                false, "", 0, "", "WAITING_FOR_UPDATE", true, null, false
            )
        );

        assertThat(projection.businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
        assertThat(projection.health()).isEqualTo(CashflowSettlementCyclePolicy.Health.OK);
        assertThat(projection.provenance()).isNull();
    }

    @Test
    void newerVerifiedCatchUpApprovalSupersedesARejectedOrWithdrawnAttempt() {
        CashflowSettlementCyclePolicy.ApprovalProvenance provenance = provenance(
            "2026-06", "2026-08", "2026-09", "approval-v7", "project-a-2026-09"
        );
        for (String attempt : new String[] {"REJECTED", "WITHDRAWN"}) {
            CashflowSettlementCyclePolicy.Projection projection = CashflowSettlementCyclePolicy.project(
                new CashflowSettlementCyclePolicy.ProjectionFacts(
                    true, attempt, 4, "OPEN", "WAITING_FOR_UPDATE", true,
                    provenance, false
                )
            );

            assertThat(projection.businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.LOCKED);
            assertThat(projection.workflowRevision()).isEqualTo(4);
            assertThat(projection.supersededAttempt()).isEqualTo(attempt);
        }
        assertThat(CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                true, "REJECTED", 4, "OPEN", "WAITING_FOR_UPDATE", false, provenance, false
            )
        ).businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
        assertThat(CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                true, "WITHDRAWN", 4, "CLOSED", "LOCKED", true, provenance, false
            )
        ).businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
    }

    @Test
    void coveredAuthorityReopenKeepsTheQueriedCycleWaitingAndRejectsUnreachableAttempts() {
        CashflowSettlementCyclePolicy.ApprovalProvenance provenance = provenance(
            "2026-06", "2026-09", "2026-10", "approval-v8", "project-a-2026-10"
        );
        for (String attempt : new String[] {"", "REJECTED", "WITHDRAWN"}) {
            CashflowSettlementCyclePolicy.Projection projection = CashflowSettlementCyclePolicy.project(
                new CashflowSettlementCyclePolicy.ProjectionFacts(
                    !attempt.isBlank(), attempt, 5, "OPEN", "WAITING_FOR_UPDATE", true,
                    provenance, true
                )
            );
            assertThat(projection.businessState())
                .as(attempt.isBlank() ? "no exact attempt" : attempt)
                .isEqualTo(CashflowSettlementCyclePolicy.BusinessState.REOPEN_REQUESTED);
            assertThat(projection.provenance()).isEqualTo(provenance);
            assertThat(projection.supersededAttempt()).isEqualTo(attempt);
        }

        assertThat(CashflowSettlementCyclePolicy.project(
            new CashflowSettlementCyclePolicy.ProjectionFacts(
                true, "REOPENED", 5, "OPEN", "WAITING_FOR_UPDATE", true, provenance, true
            )
        ).businessState()).isEqualTo(CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT);
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
                    pending, true, true, false, true, false
                )
            );
        assertThat(requesterCapabilities.get(CashflowSettlementCyclePolicy.Command.WITHDRAW_MONTH_CLOSE))
            .isEqualTo(new CashflowSettlementCyclePolicy.CommandCapability(true, ""));
        assertThat(requesterCapabilities.get(CashflowSettlementCyclePolicy.Command.APPROVE_MONTH_CLOSE))
            .isEqualTo(new CashflowSettlementCyclePolicy.CommandCapability(false, "NOT_CURRENT_APPROVER"));

        Map<CashflowSettlementCyclePolicy.Command, CashflowSettlementCyclePolicy.CommandCapability>
            approverCapabilities = CashflowSettlementCyclePolicy.commandCapabilities(
                new CashflowSettlementCyclePolicy.CapabilityFacts(
                    pending, true, true, true, false, false
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
    void otherActiveCycleBlocksOnlyCommandsThatRequireAnInactiveCoordinator() {
        for (CashflowSettlementCyclePolicy.BusinessState state : java.util.List.of(
            CashflowSettlementCyclePolicy.BusinessState.NOT_REQUESTED,
            CashflowSettlementCyclePolicy.BusinessState.REJECTED,
            CashflowSettlementCyclePolicy.BusinessState.WITHDRAWN
        )) {
            assertThat(CashflowSettlementCyclePolicy.commandCapabilities(capabilityFacts(
                state, true, true, false, false, false, false
            )).get(CashflowSettlementCyclePolicy.Command.SUBMIT_MONTH_CLOSE))
                .as(state.name())
                .isEqualTo(new CashflowSettlementCyclePolicy.CommandCapability(
                    false, "ACTIVE_CYCLE_EXISTS"
                ));
        }
        assertThat(CashflowSettlementCyclePolicy.commandCapabilities(capabilityFacts(
            CashflowSettlementCyclePolicy.BusinessState.LOCKED,
            true, true, false, false, false, false
        )).get(CashflowSettlementCyclePolicy.Command.REQUEST_MONTH_REOPEN))
            .isEqualTo(new CashflowSettlementCyclePolicy.CommandCapability(
                false, "ACTIVE_CYCLE_EXISTS"
            ));
        assertThat(allowedCommands(capabilityFacts(
            CashflowSettlementCyclePolicy.BusinessState.REOPENED,
            true, true, false, false, true, false
        ))).containsExactly(
            CashflowSettlementCyclePolicy.Command.SUBMIT_MONTH_CLOSE,
            CashflowSettlementCyclePolicy.Command.CANCEL_ACTIVE_CYCLE
        );
    }

    @Test
    void unhealthyOrInactiveReadsFailClosedForEveryCommand() {
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
                    new CashflowSettlementCyclePolicy.Projection(
                        approved.businessState(), CashflowSettlementCyclePolicy.Health.RECONCILING,
                        approved.workflowRevision(), approved.provenance(), ""
                    ),
                    true, true, false, false, false
                )
            ),
            "PROJECTION_NOT_READY"
        );
        assertAllDenied(
            CashflowSettlementCyclePolicy.commandCapabilities(
                new CashflowSettlementCyclePolicy.CapabilityFacts(
                    approved, false, false, false, false, false
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
        return capabilityFacts(
            state, activeMember, projectWriter, currentApprover, requester, recoveryAdmin, true
        );
    }

    private static CashflowSettlementCyclePolicy.CapabilityFacts capabilityFacts(
        CashflowSettlementCyclePolicy.BusinessState state,
        boolean activeMember,
        boolean projectWriter,
        boolean currentApprover,
        boolean requester,
        boolean recoveryAdmin,
        boolean coordinatorInactive
    ) {
        return new CashflowSettlementCyclePolicy.CapabilityFacts(
            new CashflowSettlementCyclePolicy.Projection(
                state, CashflowSettlementCyclePolicy.Health.OK, 1, null, ""
            ),
            activeMember,
            projectWriter,
            currentApprover,
            requester,
            recoveryAdmin,
            coordinatorInactive
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
            provenance,
            false
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
