package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public class WeeklyExpenseSpreadsheetService {
    private final WeeklyExpenseCellValidator validator;

    public WeeklyExpenseSpreadsheetService(WeeklyExpenseCellValidator validator) {
        this.validator = validator;
    }

    public ClipboardPayload copy(WeeklyExpenseSheetEntity sheet, SpreadsheetSelection selection, ClipboardDepth depth) {
        List<ClipboardCell> cells = new ArrayList<>();
        for (int rowIndex = selection.top(); rowIndex <= selection.bottom(); rowIndex += 1) {
            WeeklyExpenseRowEntity row = sheet.rowAt(rowIndex);
            for (int columnIndex = selection.left(); columnIndex <= selection.right(); columnIndex += 1) {
                WeeklyExpenseCellEntity cell = row.cellAt(columnIndex);
                cells.add(ClipboardCell.fromEntity(cell, selection.top(), selection.left(), depth));
            }
        }
        return new ClipboardPayload(
            SpreadsheetOperationType.COPY,
            depth,
            selection,
            selection.rowCount(),
            selection.columnCount(),
            cells
        );
    }

    public ClipboardPayload cut(WeeklyExpenseSheetEntity sheet, SpreadsheetSelection selection, ClipboardDepth depth) {
        ClipboardPayload payload = copy(sheet, selection, depth);
        Set<Integer> touchedRows = new LinkedHashSet<>();
        for (int rowIndex = selection.top(); rowIndex <= selection.bottom(); rowIndex += 1) {
            WeeklyExpenseRowEntity row = sheet.rowAt(rowIndex);
            touchedRows.add(rowIndex);
            for (int columnIndex = selection.left(); columnIndex <= selection.right(); columnIndex += 1) {
                WeeklyExpenseCellEntity cell = row.cellAt(columnIndex);
                cell.setRawValue("");
                cell.setNormalizedValue("");
                cell.setValidationStatus(CellValidationStatus.VALID);
                cell.setValidationMessage("");
                cell.setUserEdited(true);
            }
        }
        touchedRows.forEach(rowIndex -> recalculateRow(sheet.rowAt(rowIndex)));
        return new ClipboardPayload(
            SpreadsheetOperationType.CUT,
            depth,
            selection,
            payload.rowCount(),
            payload.columnCount(),
            payload.cells()
        );
    }

    public PasteResult paste(WeeklyExpenseSheetEntity sheet, CellAddress anchor, ClipboardPayload payload) {
        Set<Integer> touchedRows = new LinkedHashSet<>();
        List<CellValidationIssue> issues = new ArrayList<>();
        int touchedCellCount = 0;

        for (ClipboardCell clipboardCell : payload.cells()) {
            int targetRowIndex = anchor.rowIndex() + clipboardCell.relativeRow();
            int targetColumnIndex = anchor.columnIndex() + clipboardCell.relativeColumn();
            WeeklyExpenseRowEntity row = sheet.rowAt(targetRowIndex);
            WeeklyExpenseCellEntity targetCell = row.cellAt(targetColumnIndex);

            targetCell.setRawValue(clipboardCell.rawValue());
            if (payload.depth() == ClipboardDepth.DEEP) {
                targetCell.setNormalizedValue(clipboardCell.normalizedValue());
                targetCell.setValueType(clipboardCell.valueType());
                targetCell.setValidationStatus(clipboardCell.validationStatus());
                targetCell.setValidationMessage(clipboardCell.validationMessage());
            } else {
                targetCell.setNormalizedValue(clipboardCell.rawValue());
                targetCell.setValidationStatus(CellValidationStatus.UNKNOWN);
                targetCell.setValidationMessage("");
            }
            targetCell.setUserEdited(true);

            validator.validate(targetCell);
            validator.issueFor(targetCell).ifPresent(issues::add);
            touchedRows.add(targetRowIndex);
            touchedCellCount += 1;
        }

        for (Integer rowIndex : touchedRows) {
            WeeklyExpenseRowEntity row = sheet.rowAt(rowIndex);
            recalculateRow(row);
            collectRowValidationSummary(row);
        }

        return new PasteResult(touchedCellCount, touchedRows, issues);
    }

    public void recalculateRow(WeeklyExpenseRowEntity row) {
        row.setDepositAmount(moneyAt(row, WeeklyExpenseColumn.DEPOSIT_AMOUNT));
        row.setRefundAmount(moneyAt(row, WeeklyExpenseColumn.VAT_REFUND));
        row.setExpenseAmount(moneyAt(row, WeeklyExpenseColumn.EXPENSE_AMOUNT));
        row.setVatInAmount(moneyAt(row, WeeklyExpenseColumn.VAT_IN));
        row.setBankAmount(moneyAt(row, WeeklyExpenseColumn.BANK_AMOUNT));
    }

    public List<CellValidationIssue> validateAndRecalculateRows(WeeklyExpenseSheetEntity sheet) {
        List<CellValidationIssue> issues = new ArrayList<>();
        for (WeeklyExpenseRowEntity row : sheet.getRows()) {
            for (WeeklyExpenseCellEntity cell : row.getCells()) {
                validator.validate(cell);
                validator.issueFor(cell).ifPresent(issues::add);
            }
            recalculateRow(row);
            collectRowValidationSummary(row);
        }
        return issues;
    }

    private void collectRowValidationSummary(WeeklyExpenseRowEntity row) {
        int invalid = 0;
        int review = 0;
        for (WeeklyExpenseCellEntity cell : row.getCells()) {
            if (cell.getValidationStatus() == CellValidationStatus.INVALID) invalid += 1;
            if (cell.getValidationStatus() == CellValidationStatus.REVIEW_REQUIRED) review += 1;
        }
        row.setValidationErrorCount(invalid);
        row.setReviewRequiredCount(review);
    }

    private static BigDecimal moneyAt(WeeklyExpenseRowEntity row, WeeklyExpenseColumn column) {
        return row.findCell(column.index())
            .map(WeeklyExpenseCellEntity::getNormalizedValue)
            .filter(value -> !value.isBlank())
            .map(WeeklyExpenseCellValidator::parseMoney)
            .orElse(BigDecimal.ZERO);
    }
}
