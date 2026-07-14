package dev.merryai.innerplatform.weekly.api;

import java.util.Map;

public record CashflowMonthCloseResponse(
    boolean ok,
    String commandName,
    String projectId,
    String yearMonth,
    String status,
    long revision,
    long reopenCount,
    long projectWarningCount,
    String snapshotHash,
    String previousSnapshotHash,
    Map<String, Object> snapshot,
    boolean closeEligible,
    String evaluatedBusinessDate,
    String closeDeadline,
    boolean late,
    String closedAt,
    String closedByUid,
    String closedByName,
    String reopenReason,
    String reopenRequestedAt,
    String reopenRequestedByUid,
    String reopenDecision,
    String reopenDecisionReason,
    String reopenDecidedAt,
    String reopenDecidedByUid,
    String auditId
) {
    public CashflowMonthCloseResponse {
        snapshot = snapshot == null ? Map.of() : Map.copyOf(snapshot);
        snapshotHash = nullableText(snapshotHash);
        previousSnapshotHash = nullableText(previousSnapshotHash);
        evaluatedBusinessDate = nullableText(evaluatedBusinessDate);
        closeDeadline = nullableText(closeDeadline);
        closedAt = nullableText(closedAt);
        closedByUid = nullableText(closedByUid);
        closedByName = nullableText(closedByName);
        reopenReason = nullableText(reopenReason);
        reopenRequestedAt = nullableText(reopenRequestedAt);
        reopenRequestedByUid = nullableText(reopenRequestedByUid);
        reopenDecision = nullableText(reopenDecision);
        reopenDecisionReason = nullableText(reopenDecisionReason);
        reopenDecidedAt = nullableText(reopenDecidedAt);
        reopenDecidedByUid = nullableText(reopenDecidedByUid);
        auditId = nullableText(auditId);
    }

    private static String nullableText(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
