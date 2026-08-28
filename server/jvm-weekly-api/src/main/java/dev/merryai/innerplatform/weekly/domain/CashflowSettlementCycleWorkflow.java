package dev.merryai.innerplatform.weekly.domain;

import java.time.YearMonth;

/** Pure project-level serialization policy for one active settlement cycle. */
public final class CashflowSettlementCycleWorkflow {
    private CashflowSettlementCycleWorkflow() {
    }

    public static Coordinator submit(
        Coordinator current,
        String cycleYearMonth,
        String requestId,
        long expectedRevision
    ) {
        requireRevision(current, expectedRevision);
        requireInactive(current);
        return active(cycleYearMonth, requestId, ActiveState.PENDING_APPROVAL, current.workflowRevision());
    }

    public static Coordinator finishReview(
        Coordinator current,
        String requestId,
        long expectedRevision
    ) {
        requireRevision(current, expectedRevision);
        requireMatching(current, requestId, ActiveState.PENDING_APPROVAL);
        return Coordinator.inactive(increment(current.workflowRevision()));
    }

    public static Coordinator requestReopen(
        Coordinator current,
        String cycleYearMonth,
        String requestId,
        long expectedRevision
    ) {
        requireRevision(current, expectedRevision);
        requireInactive(current);
        return active(cycleYearMonth, requestId, ActiveState.REOPEN_REQUESTED, current.workflowRevision());
    }

    public static Coordinator decideReopen(
        Coordinator current,
        String requestId,
        long expectedRevision,
        boolean approved
    ) {
        requireRevision(current, expectedRevision);
        requireMatching(current, requestId, ActiveState.REOPEN_REQUESTED);
        if (!approved) return Coordinator.inactive(increment(current.workflowRevision()));
        return new Coordinator(
            current.activeCycleYearMonth(), current.activeRequestId(),
            ActiveState.REOPENED, increment(current.workflowRevision())
        );
    }

    public static Coordinator resubmit(
        Coordinator current,
        String requestId,
        long expectedRevision
    ) {
        requireRevision(current, expectedRevision);
        requireMatching(current, requestId, ActiveState.REOPENED);
        return new Coordinator(
            current.activeCycleYearMonth(), current.activeRequestId(),
            ActiveState.PENDING_APPROVAL, increment(current.workflowRevision())
        );
    }

    public static Coordinator cancelActive(
        Coordinator current,
        String requestId,
        long expectedRevision
    ) {
        requireRevision(current, expectedRevision);
        if (!current.activeRequestId().equals(normalized(requestId))) {
            throw violation(ViolationReason.REQUEST_CHANGED);
        }
        if (current.activeState() != ActiveState.PENDING_APPROVAL
            && current.activeState() != ActiveState.REOPENED) {
            throw violation(ViolationReason.STATE_CHANGED);
        }
        return Coordinator.inactive(increment(current.workflowRevision()));
    }

    private static Coordinator active(
        String cycleYearMonth,
        String requestId,
        ActiveState state,
        long currentRevision
    ) {
        String cycle = requireYearMonth(cycleYearMonth);
        String request = normalized(requestId);
        if (request.isBlank()) throw violation(ViolationReason.REQUEST_CHANGED);
        return new Coordinator(cycle, request, state, increment(currentRevision));
    }

    private static void requireInactive(Coordinator current) {
        if (current.activeState() != ActiveState.INACTIVE) {
            throw violation(ViolationReason.ACTIVE_CYCLE_EXISTS);
        }
    }

    private static void requireMatching(Coordinator current, String requestId, ActiveState expected) {
        if (!current.activeRequestId().equals(normalized(requestId))) {
            throw violation(ViolationReason.REQUEST_CHANGED);
        }
        if (current.activeState() != expected) {
            throw violation(ViolationReason.STATE_CHANGED);
        }
    }

    private static void requireRevision(Coordinator current, long expectedRevision) {
        if (current == null || current.workflowRevision() != expectedRevision) {
            throw violation(ViolationReason.REVISION_CHANGED);
        }
    }

    private static String requireYearMonth(String value) {
        try {
            return YearMonth.parse(normalized(value)).toString();
        } catch (RuntimeException error) {
            throw violation(ViolationReason.PERIOD_INVALID);
        }
    }

    private static long increment(long value) {
        try {
            return Math.addExact(value, 1);
        } catch (ArithmeticException error) {
            throw violation(ViolationReason.REVISION_CHANGED);
        }
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim();
    }

    private static Violation violation(ViolationReason reason) {
        return new Violation(reason);
    }

    public record Coordinator(
        String activeCycleYearMonth,
        String activeRequestId,
        ActiveState activeState,
        long workflowRevision
    ) {
        public Coordinator {
            activeCycleYearMonth = normalized(activeCycleYearMonth);
            activeRequestId = normalized(activeRequestId);
            activeState = activeState == null ? ActiveState.INACTIVE : activeState;
            if (workflowRevision < 0) throw violation(ViolationReason.REVISION_CHANGED);
            if (activeState == ActiveState.INACTIVE) {
                activeCycleYearMonth = "";
                activeRequestId = "";
            }
        }

        public static Coordinator inactive(long workflowRevision) {
            return new Coordinator("", "", ActiveState.INACTIVE, workflowRevision);
        }
    }

    public enum ActiveState {
        INACTIVE,
        PENDING_APPROVAL,
        REOPEN_REQUESTED,
        REOPENED
    }

    public enum ViolationReason {
        PERIOD_INVALID,
        REVISION_CHANGED,
        ACTIVE_CYCLE_EXISTS,
        REQUEST_CHANGED,
        STATE_CHANGED
    }

    public static final class Violation extends RuntimeException {
        private final ViolationReason reason;

        private Violation(ViolationReason reason) {
            super(reason.name());
            this.reason = reason;
        }

        public ViolationReason reason() {
            return reason;
        }
    }
}
