package dev.merryai.innerplatform.weekly.domain;

public record CellValidationIssue(
    int rowIndex,
    int columnIndex,
    String code,
    String message
) {
}
