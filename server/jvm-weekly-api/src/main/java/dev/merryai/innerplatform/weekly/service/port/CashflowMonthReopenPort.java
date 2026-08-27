package dev.merryai.innerplatform.weekly.service.port;

import dev.merryai.innerplatform.weekly.domain.CashflowMonthCloseState;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthReopenPolicy;

/** Application-owned boundary for the month-reopen vertical slice. */
public interface CashflowMonthReopenPort {
    CashflowMonthReopenPolicy.DecisionAuthorityFacts findCashflowMonthReopenDecisionAuthorityFacts(
        Actor actor,
        String projectId
    );

    void bindCashflowMonthReopenDecisionAuthority(
        CashflowMonthReopenPolicy.DecisionAuthority authority
    );

    CashflowMonthReopenPolicy.Facts findCashflowMonthReopenFacts(
        String tenantId,
        String projectId,
        String yearMonth
    );

    CashflowMonthCloseState applyCashflowMonthReopenRequest(
        Actor actor,
        String projectId,
        CashflowMonthReopenPolicy.RequestTransition transition,
        String reason
    );

    default CashflowMonthCloseState applyCashflowMonthReopenRequest(
        Actor actor,
        String projectId,
        CashflowMonthReopenPolicy.RequestTransition transition,
        String reason,
        SettlementCycleContext settlementCycle
    ) {
        return applyCashflowMonthReopenRequest(actor, projectId, transition, reason);
    }

    CashflowMonthCloseState applyCashflowMonthReopenDecision(
        Actor actor,
        String projectId,
        CashflowMonthReopenPolicy.DecisionTransition transition,
        String reason
    );

    default CashflowMonthCloseState applyCashflowMonthReopenDecision(
        Actor actor,
        String projectId,
        CashflowMonthReopenPolicy.DecisionTransition transition,
        String reason,
        SettlementCycleContext settlementCycle
    ) {
        return applyCashflowMonthReopenDecision(actor, projectId, transition, reason);
    }

    record Actor(String tenantId, String id, String name) {
        public Actor {
            tenantId = tenantId == null ? "" : tenantId.trim();
            id = id == null ? "" : id.trim();
            name = name == null ? "" : name.trim();
        }
    }

    record SettlementCycleContext(
        String commandId,
        String requestId,
        String cycleYearMonth,
        String monthCloseTargetYearMonth,
        long evidenceRevision,
        String manifestHash,
        long expectedWorkflowRevision
    ) {
        public SettlementCycleContext {
            commandId = normalize(commandId);
            requestId = normalize(requestId);
            cycleYearMonth = normalize(cycleYearMonth);
            monthCloseTargetYearMonth = normalize(monthCloseTargetYearMonth);
            manifestHash = normalize(manifestHash);
            boolean any = !requestId.isBlank() || !cycleYearMonth.isBlank()
                || !monthCloseTargetYearMonth.isBlank() || evidenceRevision != 0
                || !manifestHash.isBlank() || expectedWorkflowRevision != 0;
            boolean complete = !commandId.isBlank() && !requestId.isBlank() && !cycleYearMonth.isBlank()
                && !monthCloseTargetYearMonth.isBlank() && evidenceRevision > 0
                && manifestHash.matches("sha256:[a-f0-9]{64}") && expectedWorkflowRevision >= 0;
            if (any && !complete) {
                throw new IllegalArgumentException("Cashflow settlement cycle context is incomplete.");
            }
        }

        public static SettlementCycleContext none() {
            return new SettlementCycleContext("", "", "", "", 0, "", 0);
        }

        public boolean present() {
            return !requestId.isBlank();
        }

        private static String normalize(String value) {
            return value == null ? "" : value.trim();
        }
    }

    final class DecisionAuthorityUnavailable extends RuntimeException {
        public DecisionAuthorityUnavailable() {
            super("Canonical cashflow month-reopen authority is unavailable.");
        }

        public DecisionAuthorityUnavailable(Throwable cause) {
            super("Canonical cashflow month-reopen authority is unavailable.", cause);
        }
    }
}
