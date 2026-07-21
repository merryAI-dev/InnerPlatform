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
    long durationMs,
    String auditId
) {
    public record MonthResult(
        String yearMonth,
        int savedProjectionLineCount,
        int savedActualLineCount,
        List<CashflowSnapshotResponse.ProjectionLine> projection,
        List<CashflowSnapshotResponse.ActualLine> actual
    ) {
    }
}
