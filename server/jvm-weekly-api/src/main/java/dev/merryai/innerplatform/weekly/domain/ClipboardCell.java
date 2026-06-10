package dev.merryai.innerplatform.weekly.domain;

public record ClipboardCell(
    int relativeRow,
    int relativeColumn,
    String rawValue,
    String normalizedValue,
    SpreadsheetValueType valueType,
    CellValidationStatus validationStatus,
    String validationMessage
) {
    public static ClipboardCell fromEntity(
        WeeklyExpenseCellEntity cell,
        int originRow,
        int originColumn,
        ClipboardDepth depth
    ) {
        return new ClipboardCell(
            cell.getRow().getRowIndex() - originRow,
            cell.getColumnIndex() - originColumn,
            cell.getRawValue(),
            depth == ClipboardDepth.DEEP ? cell.getNormalizedValue() : cell.getRawValue(),
            depth == ClipboardDepth.DEEP ? cell.getValueType() : SpreadsheetValueType.TEXT,
            depth == ClipboardDepth.DEEP ? cell.getValidationStatus() : CellValidationStatus.UNKNOWN,
            depth == ClipboardDepth.DEEP ? cell.getValidationMessage() : ""
        );
    }
}

