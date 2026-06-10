package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CellValidationIssue;

import java.util.List;
import java.util.Set;

public record ApplyBankStatementItemsResponse(
    boolean ok,
    String commandName,
    String projectId,
    String sheetId,
    String sheetKey,
    long sheetVersion,
    int appliedLineCount,
    Set<Integer> touchedRows,
    List<CellValidationIssue> cellIssues,
    List<SaveDraftResponse.ActualDelta> actualDelta,
    String auditId
) {
}
