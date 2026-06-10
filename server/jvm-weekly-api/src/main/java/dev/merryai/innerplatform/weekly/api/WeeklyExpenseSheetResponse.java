package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record WeeklyExpenseSheetResponse(
    boolean ok,
    String projectId,
    String sheetId,
    String sheetKey,
    String sheetName,
    long sheetVersion,
    List<Row> rows
) {
    public record Row(
        String id,
        int rowIndex,
        long rowVersion,
        String sourceTxId,
        String entryKind,
        List<Cell> cells
    ) {
    }

    public record Cell(
        int columnIndex,
        String rawValue,
        String normalizedValue,
        String valueType,
        String validationStatus,
        String validationMessage,
        boolean userEdited
    ) {
    }
}
