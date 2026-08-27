package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CashflowSettlementCycleWorkflowTest {

    @Test
    void oneCoordinatorSerializesSubmitReopenResubmitAndReview() {
        CashflowSettlementCycleWorkflow.Coordinator inactive =
            CashflowSettlementCycleWorkflow.Coordinator.inactive(0);

        CashflowSettlementCycleWorkflow.Coordinator pending =
            CashflowSettlementCycleWorkflow.submit(inactive, "2026-09", "project-a-2026-09", 0);
        assertThat(pending).isEqualTo(new CashflowSettlementCycleWorkflow.Coordinator(
            "2026-09", "project-a-2026-09",
            CashflowSettlementCycleWorkflow.ActiveState.PENDING_APPROVAL, 1
        ));

        CashflowSettlementCycleWorkflow.Coordinator approved =
            CashflowSettlementCycleWorkflow.finishReview(pending, "project-a-2026-09", 1);
        assertThat(approved).isEqualTo(CashflowSettlementCycleWorkflow.Coordinator.inactive(2));

        CashflowSettlementCycleWorkflow.Coordinator reopenRequested =
            CashflowSettlementCycleWorkflow.requestReopen(
                approved, "2026-09", "project-a-2026-09", 2
            );
        CashflowSettlementCycleWorkflow.Coordinator reopened =
            CashflowSettlementCycleWorkflow.decideReopen(
                reopenRequested, "project-a-2026-09", 3, true
            );
        CashflowSettlementCycleWorkflow.Coordinator resubmitted =
            CashflowSettlementCycleWorkflow.resubmit(
                reopened, "project-a-2026-09", 4
            );
        CashflowSettlementCycleWorkflow.Coordinator reapproved =
            CashflowSettlementCycleWorkflow.finishReview(
                resubmitted, "project-a-2026-09", 5
            );

        assertThat(reopenRequested.activeState())
            .isEqualTo(CashflowSettlementCycleWorkflow.ActiveState.REOPEN_REQUESTED);
        assertThat(reopened.activeState())
            .isEqualTo(CashflowSettlementCycleWorkflow.ActiveState.REOPENED);
        assertThat(resubmitted.activeState())
            .isEqualTo(CashflowSettlementCycleWorkflow.ActiveState.PENDING_APPROVAL);
        assertThat(reapproved).isEqualTo(CashflowSettlementCycleWorkflow.Coordinator.inactive(6));
    }

    @Test
    void anotherCycleAndStaleRevisionFailBeforeChangingTheCoordinator() {
        CashflowSettlementCycleWorkflow.Coordinator pending =
            CashflowSettlementCycleWorkflow.submit(
                CashflowSettlementCycleWorkflow.Coordinator.inactive(7),
                "2026-09", "project-a-2026-09", 7
            );

        assertThatThrownBy(() -> CashflowSettlementCycleWorkflow.submit(
            pending, "2026-10", "project-a-2026-10", 8
        )).isInstanceOfSatisfying(CashflowSettlementCycleWorkflow.Violation.class, error ->
            assertThat(error.reason()).isEqualTo(
                CashflowSettlementCycleWorkflow.ViolationReason.ACTIVE_CYCLE_EXISTS
            ));
        assertThatThrownBy(() -> CashflowSettlementCycleWorkflow.finishReview(
            pending, "project-a-2026-09", 7
        )).isInstanceOfSatisfying(CashflowSettlementCycleWorkflow.Violation.class, error ->
            assertThat(error.reason()).isEqualTo(
                CashflowSettlementCycleWorkflow.ViolationReason.REVISION_CHANGED
            ));
        assertThat(pending.workflowRevision()).isEqualTo(8);
    }

    @Test
    void reopenRejectionAndRecoveryCancellationReleaseOnlyTheMatchingRequest() {
        CashflowSettlementCycleWorkflow.Coordinator requested =
            CashflowSettlementCycleWorkflow.requestReopen(
                CashflowSettlementCycleWorkflow.Coordinator.inactive(2),
                "2026-09", "request-a", 2
            );
        assertThat(CashflowSettlementCycleWorkflow.decideReopen(
            requested, "request-a", 3, false
        )).isEqualTo(CashflowSettlementCycleWorkflow.Coordinator.inactive(4));

        CashflowSettlementCycleWorkflow.Coordinator pending =
            CashflowSettlementCycleWorkflow.submit(
                CashflowSettlementCycleWorkflow.Coordinator.inactive(4),
                "2026-10", "request-b", 4
            );
        assertThat(CashflowSettlementCycleWorkflow.cancelActive(
            pending, "request-b", 5
        )).isEqualTo(CashflowSettlementCycleWorkflow.Coordinator.inactive(6));
        assertThatThrownBy(() -> CashflowSettlementCycleWorkflow.cancelActive(
            pending, "request-a", 5
        )).isInstanceOfSatisfying(CashflowSettlementCycleWorkflow.Violation.class, error ->
            assertThat(error.reason()).isEqualTo(
                CashflowSettlementCycleWorkflow.ViolationReason.REQUEST_CHANGED
            ));
    }
}
