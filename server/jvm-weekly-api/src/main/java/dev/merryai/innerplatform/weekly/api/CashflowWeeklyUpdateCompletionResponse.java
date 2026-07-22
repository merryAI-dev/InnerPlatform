package dev.merryai.innerplatform.weekly.api;

public record CashflowWeeklyUpdateCompletionResponse(
    boolean ok,
    String commandName,
    String projectId,
    String yearMonth,
    int weekNo,
    String completedAt,
    String completedBy,
    boolean alreadyCompleted,
    String status,
    long revision,
    long reopenCount,
    String snapshotHash,
    String sourceRevision,
    String targetRevision,
    String reopenedAt,
    String reopenedBy,
    String reopenReason
) {
}
