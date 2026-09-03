package dev.merryai.innerplatform.weekly.domain;

import java.time.YearMonth;
import java.util.Collections;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Pure identity and state rules for one operational cashflow settlement cycle. */
public final class CashflowSettlementCyclePolicy {
    private CashflowSettlementCyclePolicy() {
    }

    public static Identity identity(String cycleYearMonth) {
        YearMonth cycle;
        try {
            cycle = YearMonth.parse(normalized(cycleYearMonth));
        } catch (RuntimeException error) {
            throw violation(ViolationReason.PERIOD_INVALID);
        }
        if (cycle.getYear() < 2000 || cycle.getYear() > 2099) {
            throw violation(ViolationReason.PERIOD_INVALID);
        }
        return new Identity(cycle.toString(), cycle.toString(), cycle.minusMonths(1).toString());
    }

    public static String requireWeeklyTransitionPeriod(String period) {
        String normalized = normalized(period).toUpperCase(Locale.ROOT);
        if ("MONTH".equals(normalized)) {
            throw violation(ViolationReason.MONTH_REQUIRES_CLOSE_WORKFLOW);
        }
        if (!normalized.matches("WEEK_[1-5]")) {
            throw violation(ViolationReason.PERIOD_INVALID);
        }
        return normalized;
    }

    public static Lifecycle resolveMonthCloseLifecycle(MonthCloseFacts facts) {
        String request = facts.requestStatus();
        String ledger = facts.ledgerStatus();
        String settlement = canonicalMonthStatus(facts.settlementStatus());

        if (request.isBlank()) {
            if ("OPEN".equals(ledger) && "WAITING_FOR_UPDATE".equals(settlement)) {
                return Lifecycle.NOT_REQUESTED;
            }
            if ("CLOSED".equals(ledger) && "LOCKED".equals(settlement)) {
                return Lifecycle.APPROVED;
            }
            return Lifecycle.INCONSISTENT;
        }
        return switch (request) {
            case "PENDING" -> matches(ledger, settlement, "OPEN", "SUBMITTED")
                ? Lifecycle.PENDING_APPROVAL : Lifecycle.INCONSISTENT;
            case "APPROVING" -> matches(ledger, settlement, "OPEN", "SUBMITTED")
                ? Lifecycle.APPROVING : Lifecycle.INCONSISTENT;
            case "APPROVED" -> matches(ledger, settlement, "CLOSED", "LOCKED")
                ? Lifecycle.APPROVED : Lifecycle.INCONSISTENT;
            case "REOPEN_REQUESTED" -> matches(ledger, settlement, "REOPEN_REQUESTED", "LOCKED")
                ? Lifecycle.REOPEN_REQUESTED : Lifecycle.INCONSISTENT;
            case "REOPENED" -> matches(ledger, settlement, "OPEN", "WAITING_FOR_UPDATE")
                ? Lifecycle.REOPENED : Lifecycle.INCONSISTENT;
            case "REJECTED" -> matches(ledger, settlement, "OPEN", "WAITING_FOR_UPDATE")
                ? Lifecycle.REJECTED : Lifecycle.INCONSISTENT;
            case "WITHDRAWN" -> matches(ledger, settlement, "OPEN", "WAITING_FOR_UPDATE")
                ? Lifecycle.WITHDRAWN : Lifecycle.INCONSISTENT;
            case "UNCERTAIN" -> Lifecycle.UNCERTAIN;
            default -> Lifecycle.INCONSISTENT;
        };
    }

    public static Projection project(ProjectionFacts facts) {
        String request = normalized(facts.requestStatus()).toUpperCase(Locale.ROOT);
        String ledger = normalized(facts.ledgerStatus()).toUpperCase(Locale.ROOT);
        String settlement = canonicalMonthStatus(facts.settlementStatus());
        ApprovalProvenance provenance = validProvenance(facts.provenance()) ? facts.provenance() : null;
        Health health = switch (request) {
            case "BUILDING", "APPROVING", "UNCERTAIN" -> Health.RECONCILING;
            default -> Health.OK;
        };

        if (facts.workflowRevision() < 0) {
            return inconsistent(facts.workflowRevision(), health);
        }

        if (!facts.exactRequestExists() || request.isBlank() || "BUILDING".equals(request)) {
            if (provenance != null) {
                return approved(facts.workflowRevision(), health, provenance, "");
            }
            if (facts.headClaimsTargetClosed()) {
                return inconsistent(facts.workflowRevision(), health);
            }
            return new Projection(BusinessState.NOT_REQUESTED, health, facts.workflowRevision(), null, "");
        }

        if ("APPROVING".equals(request) || "UNCERTAIN".equals(request)) {
            if (provenance != null && facts.headClaimsTargetClosed()
                && matches(ledger, settlement, "CLOSED", "LOCKED")) {
                return approved(facts.workflowRevision(), health, provenance, "");
            }
            if (provenance == null && !facts.headClaimsTargetClosed()
                && matches(ledger, settlement, "OPEN", "SUBMITTED")) {
                return new Projection(
                    BusinessState.SUBMITTED, health, facts.workflowRevision(), null, ""
                );
            }
            return inconsistent(facts.workflowRevision(), health);
        }

        if (("REJECTED".equals(request) || "WITHDRAWN".equals(request)) && provenance != null) {
            return approved(facts.workflowRevision(), health, provenance, request);
        }

        return switch (request) {
            case "PENDING", "PENDING_APPROVAL" ->
                provenance == null && !facts.headClaimsTargetClosed()
                    && matches(ledger, settlement, "OPEN", "SUBMITTED")
                    ? new Projection(BusinessState.SUBMITTED, health, facts.workflowRevision(), null, "")
                    : inconsistent(facts.workflowRevision(), health);
            case "APPROVED" ->
                provenance != null && facts.headClaimsTargetClosed()
                    && matches(ledger, settlement, "CLOSED", "LOCKED")
                    ? approved(facts.workflowRevision(), health, provenance, "")
                    : inconsistent(facts.workflowRevision(), health);
            case "REOPEN_REQUESTED" ->
                provenance != null && facts.headClaimsTargetClosed()
                    && matches(ledger, settlement, "REOPEN_REQUESTED", "LOCKED")
                    ? new Projection(
                        BusinessState.REOPEN_REQUESTED, health, facts.workflowRevision(), provenance, ""
                    )
                    : inconsistent(facts.workflowRevision(), health);
            case "REOPENED" ->
                provenance == null && !facts.headClaimsTargetClosed()
                    && matches(ledger, settlement, "OPEN", "WAITING_FOR_UPDATE")
                    ? new Projection(BusinessState.REOPENED, health, facts.workflowRevision(), null, "")
                    : inconsistent(facts.workflowRevision(), health);
            case "REJECTED" ->
                provenance == null && !facts.headClaimsTargetClosed()
                    && matches(ledger, settlement, "OPEN", "WAITING_FOR_UPDATE")
                    ? new Projection(BusinessState.REJECTED, health, facts.workflowRevision(), null, "")
                    : inconsistent(facts.workflowRevision(), health);
            case "WITHDRAWN" ->
                provenance == null && !facts.headClaimsTargetClosed()
                    && matches(ledger, settlement, "OPEN", "WAITING_FOR_UPDATE")
                    ? new Projection(BusinessState.WITHDRAWN, health, facts.workflowRevision(), null, "")
                    : inconsistent(facts.workflowRevision(), health);
            default -> inconsistent(facts.workflowRevision(), health);
        };
    }

    public static Map<Command, CommandCapability> commandCapabilities(CapabilityFacts facts) {
        Projection projection = facts.projection();
        String globalDenial = globalCapabilityDenial(facts);
        EnumMap<Command, CommandCapability> capabilities = new EnumMap<>(Command.class);
        if (!globalDenial.isBlank()) {
            for (Command command : Command.values()) {
                capabilities.put(command, denied(globalDenial));
            }
            return Collections.unmodifiableMap(capabilities);
        }

        BusinessState state = projection.businessState();
        capabilities.put(Command.SUBMIT_MONTH_CLOSE, capability(
            Set.of(BusinessState.NOT_REQUESTED, BusinessState.REOPENED,
                BusinessState.REJECTED, BusinessState.WITHDRAWN).contains(state),
            facts.projectWriter(), "PROJECT_WRITE_FORBIDDEN"
        ));
        capabilities.put(Command.WITHDRAW_MONTH_CLOSE, capability(
            state == BusinessState.SUBMITTED,
            facts.projectWriter() && facts.requester(),
            facts.projectWriter() ? "NOT_REQUESTER" : "PROJECT_WRITE_FORBIDDEN"
        ));
        capabilities.put(Command.APPROVE_MONTH_CLOSE, capability(
            state == BusinessState.SUBMITTED,
            facts.currentApprover(), "NOT_CURRENT_APPROVER"
        ));
        capabilities.put(Command.REJECT_MONTH_CLOSE, capability(
            state == BusinessState.SUBMITTED,
            facts.currentApprover(), "NOT_CURRENT_APPROVER"
        ));
        capabilities.put(Command.REQUEST_MONTH_REOPEN, capability(
            state == BusinessState.LOCKED,
            facts.projectWriter(), "PROJECT_WRITE_FORBIDDEN"
        ));
        boolean reopenDecisionAuthority = facts.currentApprover() || facts.recoveryAdmin();
        capabilities.put(Command.APPROVE_MONTH_REOPEN, capability(
            state == BusinessState.REOPEN_REQUESTED,
            reopenDecisionAuthority, "REOPEN_DECISION_FORBIDDEN"
        ));
        capabilities.put(Command.REJECT_MONTH_REOPEN, capability(
            state == BusinessState.REOPEN_REQUESTED,
            reopenDecisionAuthority, "REOPEN_DECISION_FORBIDDEN"
        ));
        capabilities.put(Command.CANCEL_ACTIVE_CYCLE, capability(
            state == BusinessState.SUBMITTED || state == BusinessState.REOPENED,
            facts.recoveryAdmin(), "RECOVERY_ADMIN_REQUIRED"
        ));
        return Collections.unmodifiableMap(capabilities);
    }

    private static String globalCapabilityDenial(CapabilityFacts facts) {
        if (facts.legacyReadOnly()) return "LEGACY_READ_ONLY";
        if (facts.projection() == null
            || facts.projection().health() != Health.OK
            || facts.projection().businessState() == BusinessState.INCONSISTENT) {
            return "PROJECTION_NOT_READY";
        }
        if (!facts.activeMember()) return "ACTOR_INACTIVE";
        return "";
    }

    private static CommandCapability capability(
        boolean eligibleState,
        boolean authorized,
        String authorizationDenial
    ) {
        if (!eligibleState) return denied("BUSINESS_STATE_NOT_ELIGIBLE");
        return authorized ? new CommandCapability(true, "") : denied(authorizationDenial);
    }

    private static CommandCapability denied(String reasonCode) {
        return new CommandCapability(false, reasonCode);
    }

    private static Projection approved(
        long workflowRevision,
        Health health,
        ApprovalProvenance provenance,
        String supersededAttempt
    ) {
        return new Projection(
            BusinessState.LOCKED,
            health,
            workflowRevision,
            provenance,
            supersededAttempt
        );
    }

    private static Projection inconsistent(long workflowRevision, Health health) {
        return new Projection(BusinessState.INCONSISTENT, health, workflowRevision, null, "");
    }

    private static boolean validProvenance(ApprovalProvenance value) {
        if (value == null
            || !yearMonth(value.affectedFromMonth())
            || !yearMonth(value.affectedThroughMonth())
            || value.affectedFromMonth().compareTo(value.affectedThroughMonth()) > 0
            || !yearMonth(value.closedByCycleYearMonth())
            || normalized(value.approvalVersionId()).isBlank()
            || normalized(value.requestId()).isBlank()
            || value.ledgerRevision() < 0
            || normalized(value.rootHash()).isBlank()) {
            return false;
        }
        return true;
    }

    private static boolean yearMonth(String value) {
        return normalized(value).matches("20\\d{2}-(0[1-9]|1[0-2])");
    }

    private static boolean matches(String ledger, String settlement, String expectedLedger, String expectedSettlement) {
        return expectedLedger.equals(ledger) && expectedSettlement.equals(settlement);
    }

    public static String canonicalMonthStatus(String value) {
        return switch (normalized(value).toUpperCase(Locale.ROOT)) {
            case "PENDING_APPROVAL", "SUBMITTED" -> "SUBMITTED";
            case "COMPLETED", "LOCKED" -> "LOCKED";
            default -> normalized(value).toUpperCase(Locale.ROOT);
        };
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim();
    }

    private static Violation violation(ViolationReason reason) {
        return new Violation(reason);
    }

    public record Identity(String cycleYearMonth, String weeklyYearMonth, String monthCloseTargetYearMonth) {
    }

    public record MonthCloseFacts(String requestStatus, String ledgerStatus, String settlementStatus) {
        public MonthCloseFacts {
            requestStatus = normalized(requestStatus).toUpperCase(Locale.ROOT);
            ledgerStatus = normalized(ledgerStatus).toUpperCase(Locale.ROOT);
            settlementStatus = normalized(settlementStatus).toUpperCase(Locale.ROOT);
        }
    }

    public record ProjectionFacts(
        boolean exactRequestExists,
        String requestStatus,
        long workflowRevision,
        String ledgerStatus,
        String settlementStatus,
        boolean headClaimsTargetClosed,
        ApprovalProvenance provenance
    ) {
    }

    public record ApprovalProvenance(
        String affectedFromMonth,
        String affectedThroughMonth,
        String closedByCycleYearMonth,
        String approvalVersionId,
        String requestId,
        long ledgerRevision,
        String rootHash
    ) {
    }

    public record Projection(
        BusinessState businessState,
        Health health,
        long workflowRevision,
        ApprovalProvenance provenance,
        String supersededAttempt
    ) {
        public Projection {
            supersededAttempt = normalized(supersededAttempt).toUpperCase(Locale.ROOT);
        }
    }

    public record CapabilityFacts(
        Projection projection,
        boolean legacyReadOnly,
        boolean activeMember,
        boolean projectWriter,
        boolean currentApprover,
        boolean requester,
        boolean recoveryAdmin
    ) {
    }

    public record CommandCapability(boolean allowed, String reasonCode) {
        public CommandCapability {
            reasonCode = normalized(reasonCode).toUpperCase(Locale.ROOT);
            if (allowed && !reasonCode.isBlank()) {
                throw new IllegalArgumentException("Allowed command capability cannot have a denial reason.");
            }
            if (!allowed && reasonCode.isBlank()) {
                throw new IllegalArgumentException("Denied command capability requires a reason.");
            }
        }
    }

    public enum Command {
        SUBMIT_MONTH_CLOSE,
        WITHDRAW_MONTH_CLOSE,
        APPROVE_MONTH_CLOSE,
        REJECT_MONTH_CLOSE,
        REQUEST_MONTH_REOPEN,
        APPROVE_MONTH_REOPEN,
        REJECT_MONTH_REOPEN,
        CANCEL_ACTIVE_CYCLE
    }

    public enum BusinessState {
        NOT_REQUESTED,
        SUBMITTED,
        LOCKED,
        REOPEN_REQUESTED,
        REOPENED,
        REJECTED,
        WITHDRAWN,
        INCONSISTENT
    }

    public enum Health {
        OK,
        RECONCILING,
        UNAVAILABLE
    }

    public enum Lifecycle {
        NOT_REQUESTED,
        PENDING_APPROVAL,
        APPROVING,
        APPROVED,
        REOPEN_REQUESTED,
        REOPENED,
        REJECTED,
        WITHDRAWN,
        UNCERTAIN,
        INCONSISTENT
    }

    public enum ViolationReason {
        PERIOD_INVALID,
        MONTH_REQUIRES_CLOSE_WORKFLOW
    }

    public static final class Violation extends IllegalArgumentException {
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
