package dev.merryai.innerplatform.weekly.domain;

public final class CashflowMonthReopenApprovalPolicy {
    private CashflowMonthReopenApprovalPolicy() {
    }

    public static Decision decide(String requestedByUid, String decidedByUid) {
        if (requestedByUid == null || requestedByUid.isBlank()) return Decision.LEGACY_REQUESTER_MISSING;
        return requestedByUid.equals(decidedByUid) ? Decision.SELF_APPROVAL_FORBIDDEN : Decision.ALLOWED;
    }

    public enum Decision {
        ALLOWED,
        LEGACY_REQUESTER_MISSING,
        SELF_APPROVAL_FORBIDDEN
    }
}
