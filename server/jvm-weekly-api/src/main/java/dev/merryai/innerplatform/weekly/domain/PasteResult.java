package dev.merryai.innerplatform.weekly.domain;

import java.util.List;
import java.util.Set;

public record PasteResult(
    int touchedCellCount,
    Set<Integer> touchedRows,
    List<CellValidationIssue> validationIssues
) {
    public PasteResult {
        touchedRows = Set.copyOf(touchedRows);
        validationIssues = List.copyOf(validationIssues);
    }

    public boolean hasBlockingErrors() {
        return validationIssues.stream().anyMatch(issue -> !"review_required".equals(issue.code()));
    }
}
