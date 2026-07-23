package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowSheetBatchApplyResponse(
    boolean ok,
    String commandName,
    String projectId,
    String sourceSheetKey,
    String sourceRevision,
    String targetRevision,
    String resultingTargetRevision,
    int savedProjectionLineCount,
    int savedActualLineCount,
    List<MonthResult> months,
    List<SettledWeekChange> settledWeekChanges,
    long durationMs,
    String auditId
) {
    public CashflowSheetBatchApplyResponse(
        boolean ok,
        String commandName,
        String projectId,
        String sourceSheetKey,
        String sourceRevision,
        String targetRevision,
        String resultingTargetRevision,
        int savedProjectionLineCount,
        int savedActualLineCount,
        List<MonthResult> months,
        long durationMs,
        String auditId
    ) {
        this(
            ok,
            commandName,
            projectId,
            sourceSheetKey,
            sourceRevision,
            targetRevision,
            resultingTargetRevision,
            savedProjectionLineCount,
            savedActualLineCount,
            months,
            List.of(),
            durationMs,
            auditId
        );
    }

    public record MonthResult(
        String yearMonth,
        int savedProjectionLineCount,
        int savedActualLineCount,
        List<CashflowSnapshotResponse.ProjectionLine> projection,
        List<CashflowSnapshotResponse.ActualLine> actual
    ) {
    }

    public record SettledWeekChange(
        String yearMonth,
        int weekNo,
        long completionRevision,
        long warningCount
    ) {
    }
}
