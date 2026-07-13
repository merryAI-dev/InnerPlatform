package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CellValidationIssue;
import dev.merryai.innerplatform.weekly.domain.ClipboardPayload;

import java.util.List;
import java.util.Set;

public record CellCommandResponse(
    boolean ok,
    String commandName,
    String projectId,
    String sheetId,
    String sheetKey,
    long sheetVersion,
    Set<Integer> touchedRows,
    int touchedCellCount,
    List<CellValidationIssue> cellIssues,
    List<SaveDraftResponse.ActualDelta> actualDelta,
    ClipboardPayload clipboard,
    String auditId
) {
}
