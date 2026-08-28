package dev.merryai.innerplatform.weekly.domain;

import java.time.YearMonth;

/**
 * 월 결산 재오픈의 순수 비즈니스 정책.
 *
 * <p>영속 어댑터는 저장된 사실을 {@link Facts} 로 매핑하고 이 정책이 정한 transition 을
 * 원자적으로 기록한다. 이 클래스는 HTTP, application service, Firestore를 알지 않는다.
 */
public final class CashflowMonthReopenPolicy {
    private CashflowMonthReopenPolicy() {
    }

    public static DecisionAuthority requireDecisionAuthority(DecisionAuthorityFacts facts) {
        boolean exactActiveMember = facts.actorUid().equals(facts.memberUid())
            && "ACTIVE".equals(facts.memberStatus());
        boolean exactProject = facts.projectExists()
            && facts.actorTenantId().equals(facts.projectTenantId())
            && facts.requestedProjectId().equals(facts.storedProjectId());
        boolean exactPeopleUid = facts.peopleUidMatchCount() == 1;
        boolean designatedApprover = facts.actorUid().equals(facts.executiveApproverUid());
        boolean runtimeAdmin = "admin".equals(facts.storedRole());
        if (!exactActiveMember || !exactProject || !exactPeopleUid || facts.storedRole().isBlank()
            || !(runtimeAdmin || designatedApprover)) {
            throw violation(ViolationReason.DECISION_FORBIDDEN);
        }
        return new DecisionAuthority(
            facts.actorTenantId(),
            facts.actorUid(),
            facts.requestedProjectId(),
            facts.storedRole()
        );
    }

    public static RequestTransition request(Facts facts, String yearMonth, long expectedRevision) {
        requirePeriod(yearMonth);
        if (facts.cumulative() && !yearMonth.equals(latestSettlementMonth(facts))) {
            throw violation(ViolationReason.LATEST_HORIZON_ONLY);
        }
        if (!facts.monthExists() || facts.monthState() != State.CLOSED) {
            throw violation(ViolationReason.MONTH_NOT_CLOSED);
        }
        if (facts.monthRevision() != expectedRevision) {
            throw violation(ViolationReason.REVISION_CHANGED);
        }
        return new RequestTransition(
            yearMonth,
            expectedRevision,
            State.REOPEN_REQUESTED,
            increment(expectedRevision),
            facts.monthReopenCount(),
            facts.projectWarningCount()
        );
    }

    public static DecisionTransition decide(
        Facts facts,
        String yearMonth,
        long expectedRevision,
        Decision decision
    ) {
        requirePeriod(yearMonth);
        if (facts.cumulative() && !yearMonth.equals(latestSettlementMonth(facts))) {
            throw violation(ViolationReason.LATEST_REQUEST_REQUIRED);
        }
        if (!facts.monthExists()) {
            throw violation(ViolationReason.REQUEST_MISSING);
        }
        if (facts.monthState() != State.REOPEN_REQUESTED) {
            throw violation(ViolationReason.NOT_AWAITING_DECISION);
        }
        if (facts.monthRevision() != expectedRevision) {
            throw violation(ViolationReason.REVISION_CHANGED);
        }
        if (decision == null) {
            throw violation(ViolationReason.DECISION_INVALID);
        }

        boolean approved = decision == Decision.APPROVE;
        String dataYearMonth = facts.cumulative() && !facts.affectedThroughMonth().isBlank()
            ? facts.affectedThroughMonth()
            : facts.cumulative() && !facts.closedThrough().isBlank() ? facts.closedThrough() : yearMonth;
        String nextClosedThrough = "";
        String nextSettlementMonth = "";
        if (approved && facts.cumulative()) {
            requireRestorationEvidence(facts);
            nextClosedThrough = facts.previousAuthorityExists() ? facts.previousClosedThrough() : "";
            nextSettlementMonth = facts.previousAuthorityExists() ? facts.previousSettlementMonth() : "";
        }

        return new DecisionTransition(
            yearMonth,
            decision,
            expectedRevision,
            approved ? State.OPEN : State.CLOSED,
            increment(expectedRevision),
            approved ? increment(facts.monthReopenCount()) : facts.monthReopenCount(),
            approved ? increment(facts.projectWarningCount()) : facts.projectWarningCount(),
            facts.cumulative(),
            facts.cumulative() && facts.previousAuthorityExists() ? State.CLOSED
                : facts.cumulative() ? State.OPEN : State.UNKNOWN,
            approved && facts.cumulative() ? increment(facts.headRevision()) : facts.headRevision(),
            nextClosedThrough,
            nextSettlementMonth,
            dataYearMonth,
            facts.requestedByUid().isBlank(),
            facts.previousAuthorityExists(),
            facts.affectedFromMonth(),
            facts.affectedThroughMonth(),
            facts.approvalVersionId()
        );
    }

    public static DecisionTransition decideLegacy(
        Facts facts,
        String yearMonth,
        long expectedRevision,
        Decision decision
    ) {
        requirePeriod(yearMonth);
        if (facts.cumulative() && !yearMonth.equals(latestSettlementMonth(facts))) {
            throw violation(ViolationReason.LATEST_REQUEST_REQUIRED);
        }
        if (!facts.monthExists()) {
            throw violation(ViolationReason.REQUEST_MISSING);
        }
        if (facts.monthState() != State.REOPEN_REQUESTED) {
            throw violation(ViolationReason.NOT_AWAITING_DECISION);
        }
        if (facts.monthRevision() != expectedRevision) {
            throw violation(ViolationReason.REVISION_CHANGED);
        }
        if (decision == null) {
            throw violation(ViolationReason.DECISION_INVALID);
        }

        boolean approved = decision == Decision.APPROVE;
        String dataYearMonth = facts.cumulative() && !facts.closedThrough().isBlank()
            ? facts.closedThrough()
            : yearMonth;
        String nextClosedThrough = "";
        String nextSettlementMonth = "";
        if (approved && facts.cumulative()) {
            nextClosedThrough = YearMonth.parse(dataYearMonth).minusMonths(1).toString();
            nextSettlementMonth = YearMonth.parse(nextClosedThrough).plusMonths(1).toString();
        }

        return new DecisionTransition(
            yearMonth,
            decision,
            expectedRevision,
            approved ? State.OPEN : State.CLOSED,
            increment(expectedRevision),
            approved ? increment(facts.monthReopenCount()) : facts.monthReopenCount(),
            approved ? increment(facts.projectWarningCount()) : facts.projectWarningCount(),
            facts.cumulative(),
            facts.cumulative() ? State.CLOSED : State.UNKNOWN,
            approved && facts.cumulative() ? increment(facts.headRevision()) : facts.headRevision(),
            nextClosedThrough,
            nextSettlementMonth,
            dataYearMonth,
            facts.requestedByUid().isBlank(),
            false,
            "",
            "",
            ""
        );
    }

    private static void requireRestorationEvidence(Facts facts) {
        if (facts.approvalVersionId().isBlank()
            || facts.affectedFromMonth().isBlank()
            || facts.affectedThroughMonth().isBlank()) {
            throw violation(ViolationReason.REQUEST_MISSING);
        }
        YearMonth affectedFrom;
        YearMonth affectedThrough;
        try {
            affectedFrom = YearMonth.parse(facts.affectedFromMonth());
            affectedThrough = YearMonth.parse(facts.affectedThroughMonth());
        } catch (RuntimeException error) {
            throw violation(ViolationReason.REQUEST_MISSING);
        }
        if (affectedFrom.isAfter(affectedThrough)) {
            throw violation(ViolationReason.REQUEST_MISSING);
        }
        if (!facts.previousAuthorityExists()) {
            if (!facts.previousSettlementMonth().isBlank() || !facts.previousClosedThrough().isBlank()) {
                throw violation(ViolationReason.REQUEST_MISSING);
            }
            return;
        }
        try {
            YearMonth settlement = YearMonth.parse(facts.previousSettlementMonth());
            YearMonth closedThrough = YearMonth.parse(facts.previousClosedThrough());
            if (!settlement.minusMonths(1).equals(closedThrough)) {
                throw violation(ViolationReason.REQUEST_MISSING);
            }
        } catch (Violation error) {
            throw error;
        } catch (RuntimeException error) {
            throw violation(ViolationReason.REQUEST_MISSING);
        }
    }

    private static String latestSettlementMonth(Facts facts) {
        return facts.settlementMonth().isBlank() ? facts.closedThrough() : facts.settlementMonth();
    }

    private static long increment(long value) {
        try {
            return Math.addExact(value, 1);
        } catch (ArithmeticException error) {
            throw violation(ViolationReason.COUNTER_OUT_OF_RANGE);
        }
    }

    private static void requirePeriod(String yearMonth) {
        try {
            YearMonth.parse(yearMonth);
        } catch (RuntimeException error) {
            throw violation(ViolationReason.PERIOD_INVALID);
        }
    }

    private static Violation violation(ViolationReason reason) {
        return new Violation(reason);
    }

    public record Facts(
        boolean cumulative,
        String settlementMonth,
        String closedThrough,
        long headRevision,
        boolean monthExists,
        State monthState,
        long monthRevision,
        long monthReopenCount,
        long projectWarningCount,
        String requestedByUid,
        boolean previousAuthorityExists,
        String previousSettlementMonth,
        String previousClosedThrough,
        String affectedFromMonth,
        String affectedThroughMonth,
        String approvalVersionId
    ) {
        public Facts {
            settlementMonth = settlementMonth == null ? "" : settlementMonth.trim();
            closedThrough = closedThrough == null ? "" : closedThrough.trim();
            monthState = monthState == null ? State.UNKNOWN : monthState;
            requestedByUid = requestedByUid == null ? "" : requestedByUid.trim();
            previousSettlementMonth = normalized(previousSettlementMonth);
            previousClosedThrough = normalized(previousClosedThrough);
            affectedFromMonth = normalized(affectedFromMonth);
            affectedThroughMonth = normalized(affectedThroughMonth);
            approvalVersionId = normalized(approvalVersionId);
        }

        public Facts(
            boolean cumulative,
            String settlementMonth,
            String closedThrough,
            long headRevision,
            boolean monthExists,
            State monthState,
            long monthRevision,
            long monthReopenCount,
            long projectWarningCount,
            String requestedByUid
        ) {
            this(
                cumulative, settlementMonth, closedThrough, headRevision, monthExists, monthState,
                monthRevision, monthReopenCount, projectWarningCount, requestedByUid,
                false, "", "", "", "", ""
            );
        }
    }

    public record DecisionAuthorityFacts(
        String actorTenantId,
        String actorUid,
        String requestedProjectId,
        boolean projectExists,
        String projectTenantId,
        String storedProjectId,
        String memberUid,
        String memberStatus,
        String storedRole,
        String executiveApproverUid,
        int peopleUidMatchCount
    ) {
        public DecisionAuthorityFacts {
            actorTenantId = normalized(actorTenantId);
            actorUid = normalized(actorUid);
            requestedProjectId = normalized(requestedProjectId);
            projectTenantId = normalized(projectTenantId);
            storedProjectId = normalized(storedProjectId);
            memberUid = normalized(memberUid);
            memberStatus = normalized(memberStatus).toUpperCase(java.util.Locale.ROOT);
            storedRole = normalized(storedRole).toLowerCase(java.util.Locale.ROOT);
            executiveApproverUid = normalized(executiveApproverUid);
        }
    }

    public record DecisionAuthority(
        String tenantId,
        String actorUid,
        String projectId,
        String storedRole
    ) {
    }

    public record RequestTransition(
        String yearMonth,
        long expectedRevision,
        State nextMonthState,
        long nextMonthRevision,
        long monthReopenCount,
        long projectWarningCount
    ) {
    }

    public record DecisionTransition(
        String yearMonth,
        Decision decision,
        long expectedRevision,
        State nextMonthState,
        long nextMonthRevision,
        long nextReopenCount,
        long nextProjectWarningCount,
        boolean cumulative,
        State nextHeadState,
        long nextHeadRevision,
        String nextClosedThrough,
        String nextSettlementMonth,
        String dataYearMonth,
        boolean legacyRequesterMissing,
        boolean previousAuthorityExists,
        String affectedFromMonth,
        String affectedThroughMonth,
        String approvalVersionId
    ) {
        public boolean approved() {
            return decision == Decision.APPROVE;
        }

        public boolean updatesHeadAuthority() {
            return approved() && cumulative;
        }
    }

    public enum State {
        OPEN,
        CLOSED,
        REOPEN_REQUESTED,
        UNKNOWN;

        public static State fromStorage(String value) {
            if (value == null) return UNKNOWN;
            try {
                return valueOf(value.trim().toUpperCase(java.util.Locale.ROOT));
            } catch (IllegalArgumentException error) {
                return UNKNOWN;
            }
        }
    }

    public enum Decision {
        APPROVE,
        REJECT
    }

    public enum ViolationReason {
        DECISION_FORBIDDEN,
        LATEST_HORIZON_ONLY,
        MONTH_NOT_CLOSED,
        REVISION_CHANGED,
        LATEST_REQUEST_REQUIRED,
        REQUEST_MISSING,
        NOT_AWAITING_DECISION,
        DECISION_INVALID,
        PERIOD_INVALID,
        COUNTER_OUT_OF_RANGE
    }

    public static final class Violation extends RuntimeException {
        private final ViolationReason reason;

        public Violation(ViolationReason reason) {
            super(reason.name());
            this.reason = reason;
        }

        public ViolationReason reason() {
            return reason;
        }
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim();
    }
}
