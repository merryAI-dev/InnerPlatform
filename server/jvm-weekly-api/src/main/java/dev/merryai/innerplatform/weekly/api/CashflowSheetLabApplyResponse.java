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
    String auditId
) {
}
