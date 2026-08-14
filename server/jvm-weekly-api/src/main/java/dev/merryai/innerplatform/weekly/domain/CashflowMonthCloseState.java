package dev.merryai.innerplatform.weekly.domain;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Canonical month-close state returned by persistence ports without exposing storage types. */
public record CashflowMonthCloseState(
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
    boolean additionalHistoricalEvidence
) {
    public CashflowMonthCloseState {
        lastAmendmentEvidence = immutableCopy(lastAmendmentEvidence);
        snapshot = immutableCopy(snapshot);
        previousSnapshot = immutableCopy(previousSnapshot);
    }

    public boolean isPristineOpen() {
        return "OPEN".equals(status)
            && revision == 0
            && reopenCount == 0
            && amendmentCount == 0
            && postDeadlineAmendmentWarningCount == 0
            && blank(lastAmendmentAt)
            && blank(lastAmendmentByUid)
            && blank(lastAmendmentByName)
            && blank(lastAmendmentReason)
            && blank(lastAmendmentDeadline)
            && !lastAmendmentPostDeadline
            && lastAmendmentEvidence.isEmpty()
            && blank(snapshotHash)
            && blank(previousSnapshotHash)
            && snapshot.isEmpty()
            && previousSnapshot.isEmpty()
            && blank(closedAt)
            && blank(closedByUid)
            && blank(closedByName)
            && blank(reopenReason)
            && blank(reopenRequestedAt)
            && blank(reopenRequestedByUid)
            && blank(reopenDecision)
            && blank(reopenDecisionReason)
            && blank(reopenDecidedAt)
            && blank(reopenDecidedByUid)
            && !additionalHistoricalEvidence;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static Map<String, Object> immutableCopy(Map<String, Object> source) {
        return source == null || source.isEmpty()
            ? Map.of()
            : Collections.unmodifiableMap(new LinkedHashMap<>(source));
    }
}
