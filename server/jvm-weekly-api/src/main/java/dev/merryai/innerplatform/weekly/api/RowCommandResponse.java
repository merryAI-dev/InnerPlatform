package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CellValidationIssue;

import java.util.List;
import java.util.Set;

public record RowCommandResponse(
    boolean ok,
    String commandName,
    String projectId,
    String sheetId,
    String sheetKey,
    long sheetVersion,
    Set<Integer> touchedRows,
    int affectedRowCount,
    List<CellValidationIssue> cellIssues,
    List<SaveDraftResponse.ActualDelta> actualDelta,
    String auditId
) {
}
