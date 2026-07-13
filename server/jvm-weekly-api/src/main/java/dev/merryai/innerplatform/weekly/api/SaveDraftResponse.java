package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CellValidationIssue;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;

public record SaveDraftResponse(
    boolean ok,
    String commandName,
    String projectId,
    String sheetId,
    String sheetKey,
    long sheetVersion,
    int savedRowCount,
    int savedCellCount,
    Set<Integer> touchedRows,
    List<CellValidationIssue> cellIssues,
    List<ActualDelta> actualDelta,
    String auditId
) {
    public record ActualDelta(
        String yearMonth,
        int weekNo,
        String cashflowLine,
        BigDecimal amount
    ) {
    }
}
