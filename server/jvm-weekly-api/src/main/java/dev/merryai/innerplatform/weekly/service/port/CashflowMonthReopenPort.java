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

    CashflowMonthCloseState applyCashflowMonthReopenDecision(
        Actor actor,
        String projectId,
        CashflowMonthReopenPolicy.DecisionTransition transition,
        String reason
    );

    record Actor(String tenantId, String id, String name) {
        public Actor {
            tenantId = tenantId == null ? "" : tenantId.trim();
            id = id == null ? "" : id.trim();
            name = name == null ? "" : name.trim();
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
