package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowSheetLabApplyResponse(
    boolean ok,
    String commandName,
    String projectId,
    String sourceSheetKey,
    String yearMonth,
    String sourceRevision,
    String targetRevision,
    String resultingTargetRevision,
    int savedProjectionLineCount,
    int savedActualLineCount,
    List<CashflowSnapshotResponse.ProjectionLine> projection,
    List<CashflowSnapshotResponse.ActualLine> actual,
    List<CashflowSheetBatchApplyResponse.SettledWeekChange> settledWeekChanges,
    String auditId
) {
    public CashflowSheetLabApplyResponse(
        boolean ok,
        String commandName,
        String projectId,
        String sourceSheetKey,
        String yearMonth,
        String sourceRevision,
        String targetRevision,
        String resultingTargetRevision,
        int savedProjectionLineCount,
        int savedActualLineCount,
        List<CashflowSnapshotResponse.ProjectionLine> projection,
        List<CashflowSnapshotResponse.ActualLine> actual,
        String auditId
    ) {
        this(
            ok,
            commandName,
            projectId,
            sourceSheetKey,
            yearMonth,
            sourceRevision,
            targetRevision,
            resultingTargetRevision,
            savedProjectionLineCount,
            savedActualLineCount,
            projection,
            actual,
            List.of(),
            auditId
        );
    }
}
