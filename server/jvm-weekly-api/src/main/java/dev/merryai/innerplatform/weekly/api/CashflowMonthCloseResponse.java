package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CashflowMonthCloseState;

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
    long amendmentCount,
    long postDeadlineAmendmentWarningCount,
    String lastAmendmentAt,
    String lastAmendmentByUid,
    String lastAmendmentByName,
    String lastAmendmentReason,
    String lastAmendmentDeadline,
    boolean lastAmendmentPostDeadline,
    Map<String, Object> lastAmendmentEvidence,
    String snapshotHash,
    String previousSnapshotHash,
    Map<String, Object> snapshot,
    Map<String, Object> previousSnapshot,
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
    String auditId,
    String requestId,
    long requestRevision,
    String manifestHash,
    String rootHash,
    long headRevision
) {
    public CashflowMonthCloseResponse {
        snapshot = snapshot == null ? Map.of() : Map.copyOf(snapshot);
        previousSnapshot = previousSnapshot == null ? Map.of() : Map.copyOf(previousSnapshot);
        lastAmendmentEvidence = lastAmendmentEvidence == null ? Map.of() : Map.copyOf(lastAmendmentEvidence);
        snapshotHash = nullableText(snapshotHash);
        previousSnapshotHash = nullableText(previousSnapshotHash);
        lastAmendmentAt = nullableText(lastAmendmentAt);
        lastAmendmentByUid = nullableText(lastAmendmentByUid);
        lastAmendmentByName = nullableText(lastAmendmentByName);
        lastAmendmentReason = nullableText(lastAmendmentReason);
        lastAmendmentDeadline = nullableText(lastAmendmentDeadline);
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
        requestId = nullableText(requestId);
        manifestHash = nullableText(manifestHash);
        rootHash = nullableText(rootHash);
    }

    public CashflowMonthCloseResponse(
        boolean ok, String commandName, String projectId, String yearMonth, String status, long revision,
        long reopenCount, long projectWarningCount, long amendmentCount, long postDeadlineAmendmentWarningCount,
        String lastAmendmentAt, String lastAmendmentByUid, String lastAmendmentByName, String lastAmendmentReason,
        String lastAmendmentDeadline, boolean lastAmendmentPostDeadline, Map<String, Object> lastAmendmentEvidence,
        String snapshotHash, String previousSnapshotHash, Map<String, Object> snapshot,
        Map<String, Object> previousSnapshot, boolean closeEligible, String evaluatedBusinessDate,
        String closeDeadline, boolean late, String closedAt, String closedByUid, String closedByName,
        String reopenReason, String reopenRequestedAt, String reopenRequestedByUid, String reopenDecision,
        String reopenDecisionReason, String reopenDecidedAt, String reopenDecidedByUid, String auditId
    ) {
        this(
            ok, commandName, projectId, yearMonth, status, revision, reopenCount, projectWarningCount,
            amendmentCount, postDeadlineAmendmentWarningCount, lastAmendmentAt, lastAmendmentByUid,
            lastAmendmentByName, lastAmendmentReason, lastAmendmentDeadline, lastAmendmentPostDeadline,
            lastAmendmentEvidence, snapshotHash, previousSnapshotHash, snapshot, previousSnapshot, closeEligible,
            evaluatedBusinessDate, closeDeadline, late, closedAt, closedByUid, closedByName, reopenReason,
            reopenRequestedAt, reopenRequestedByUid, reopenDecision, reopenDecisionReason, reopenDecidedAt,
            reopenDecidedByUid, auditId, "", 0, "", "", 0
        );
    }

    public CashflowMonthCloseResponse withStatus(String operationalStatus) {
        return new CashflowMonthCloseResponse(
            ok, commandName, projectId, yearMonth, operationalStatus, revision, reopenCount,
            projectWarningCount, amendmentCount, postDeadlineAmendmentWarningCount,
            lastAmendmentAt, lastAmendmentByUid, lastAmendmentByName, lastAmendmentReason,
            lastAmendmentDeadline, lastAmendmentPostDeadline, lastAmendmentEvidence,
            snapshotHash, previousSnapshotHash, snapshot, previousSnapshot, closeEligible,
            evaluatedBusinessDate, closeDeadline, late, closedAt, closedByUid, closedByName,
            reopenReason, reopenRequestedAt, reopenRequestedByUid, reopenDecision,
            reopenDecisionReason, reopenDecidedAt, reopenDecidedByUid, auditId, requestId,
            requestRevision, manifestHash, rootHash, headRevision
        );
    }

    public static CashflowMonthCloseResponse fromState(
        String commandName,
        CashflowMonthCloseState state,
        String auditId,
        String status
    ) {
        return new CashflowMonthCloseResponse(
            true,
            commandName,
            state.projectId(),
            state.yearMonth(),
            status,
            state.revision(),
            state.reopenCount(),
            state.projectWarningCount(),
            state.amendmentCount(),
            state.postDeadlineAmendmentWarningCount(),
            state.lastAmendmentAt(),
            state.lastAmendmentByUid(),
            state.lastAmendmentByName(),
            state.lastAmendmentReason(),
            state.lastAmendmentDeadline(),
            state.lastAmendmentPostDeadline(),
            state.lastAmendmentEvidence(),
            state.snapshotHash(),
            state.previousSnapshotHash(),
            state.snapshot(),
            state.previousSnapshot(),
            state.closeEligible(),
            state.evaluatedBusinessDate(),
            state.closeDeadline(),
            state.late(),
            state.closedAt(),
            state.closedByUid(),
            state.closedByName(),
            state.reopenReason(),
            state.reopenRequestedAt(),
            state.reopenRequestedByUid(),
            state.reopenDecision(),
            state.reopenDecisionReason(),
            state.reopenDecidedAt(),
            state.reopenDecidedByUid(),
            auditId,
            String.valueOf(state.snapshot().getOrDefault("requestId", "")),
            longMetadata(state.snapshot().get("requestRevision")),
            String.valueOf(state.snapshot().getOrDefault("manifestHash", "")),
            String.valueOf(state.snapshot().getOrDefault("rootHash", "")),
            longMetadata(state.snapshot().get("headRevision"))
        );
    }

    private static long longMetadata(Object value) {
        if (value instanceof Number number) return number.longValue();
        if (value instanceof String text && text.matches("\\d+")) return Long.parseLong(text);
        return 0;
    }

    private static String nullableText(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
