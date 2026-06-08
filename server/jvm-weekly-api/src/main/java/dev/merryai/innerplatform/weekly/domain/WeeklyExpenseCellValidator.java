package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Optional;

public final class WeeklyExpenseCellValidator {
    public WeeklyExpenseCellEntity validate(WeeklyExpenseCellEntity cell) {
        WeeklyExpenseColumn column = WeeklyExpenseColumn.fromIndex(cell.getColumnIndex()).orElse(null);
        if (column == null) {
            cell.setValueType(SpreadsheetValueType.TEXT);
            cell.setNormalizedValue(normalizeText(cell.getRawValue()));
            cell.setValidationStatus(CellValidationStatus.VALID);
            cell.setValidationMessage("");
            return cell;
        }

        cell.setValueType(column.valueType());
        String raw = cell.getRawValue();
        if (raw == null || raw.isBlank()) {
            cell.setNormalizedValue("");
            if (column == WeeklyExpenseColumn.CASHFLOW_LINE) {
                cell.setValidationStatus(CellValidationStatus.REVIEW_REQUIRED);
                cell.setValidationMessage("cashflow항목은 Actual 집계 전에 사람이 확인해야 합니다.");
                return cell;
            }
            cell.setValidationStatus(CellValidationStatus.VALID);
            cell.setValidationMessage("");
            return cell;
        }

        switch (column.valueType()) {
            case NUMBER -> validateNumber(cell);
            case DATE -> validateDate(cell);
            case BOOLEAN -> validateBoolean(cell);
            case TEXT -> validateText(cell, column);
        }
        return cell;
    }

    public Optional<CellValidationIssue> issueFor(WeeklyExpenseCellEntity cell) {
        if (cell.getValidationStatus() == CellValidationStatus.INVALID) {
            return Optional.of(new CellValidationIssue(
                cell.getRow().getRowIndex(),
                cell.getColumnIndex(),
                "invalid_cell",
                cell.getValidationMessage()
            ));
        }
        if (cell.getValidationStatus() == CellValidationStatus.REVIEW_REQUIRED) {
            return Optional.of(new CellValidationIssue(
                cell.getRow().getRowIndex(),
                cell.getColumnIndex(),
                "review_required",
                cell.getValidationMessage()
            ));
        }
        return Optional.empty();
    }

    private static void validateNumber(WeeklyExpenseCellEntity cell) {
        try {
            BigDecimal parsed = parseMoney(cell.getRawValue());
            cell.setNormalizedValue(parsed.stripTrailingZeros().toPlainString());
            cell.setValidationStatus(CellValidationStatus.VALID);
            cell.setValidationMessage("");
        } catch (NumberFormatException error) {
            cell.setNormalizedValue("");
            cell.setValidationStatus(CellValidationStatus.INVALID);
            cell.setValidationMessage("숫자 컬럼에는 숫자, 콤마, 원 기호만 입력할 수 있습니다.");
        }
    }

    private static void validateDate(WeeklyExpenseCellEntity cell) {
        String raw = normalizeText(cell.getRawValue()).replace('.', '-').replace('/', '-');
        try {
            LocalDate parsed = LocalDate.parse(raw, DateTimeFormatter.ISO_LOCAL_DATE);
            cell.setNormalizedValue(parsed.toString());
            cell.setValidationStatus(CellValidationStatus.VALID);
            cell.setValidationMessage("");
        } catch (DateTimeParseException error) {
            cell.setNormalizedValue("");
            cell.setValidationStatus(CellValidationStatus.INVALID);
            cell.setValidationMessage("날짜는 YYYY-MM-DD 형식이어야 합니다.");
        }
    }

    private static void validateBoolean(WeeklyExpenseCellEntity cell) {
        String normalized = normalizeText(cell.getRawValue()).toLowerCase();
        if (normalized.equals("y") || normalized.equals("yes") || normalized.equals("true") || normalized.equals("1")) {
            cell.setNormalizedValue("true");
            cell.setValidationStatus(CellValidationStatus.VALID);
            cell.setValidationMessage("");
            return;
        }
        if (normalized.equals("n") || normalized.equals("no") || normalized.equals("false") || normalized.equals("0")) {
            cell.setNormalizedValue("false");
            cell.setValidationStatus(CellValidationStatus.VALID);
            cell.setValidationMessage("");
            return;
        }
        cell.setNormalizedValue("");
        cell.setValidationStatus(CellValidationStatus.INVALID);
        cell.setValidationMessage("불리언 컬럼은 Y/N 또는 true/false만 허용합니다.");
    }

    private static void validateText(WeeklyExpenseCellEntity cell, WeeklyExpenseColumn column) {
        String normalized = normalizeText(cell.getRawValue());
        cell.setNormalizedValue(normalized);
        if (column == WeeklyExpenseColumn.CASHFLOW_LINE && normalized.isBlank()) {
            cell.setValidationStatus(CellValidationStatus.REVIEW_REQUIRED);
            cell.setValidationMessage("cashflow항목은 Actual 집계 전에 사람이 확인해야 합니다.");
            return;
        }
        cell.setValidationStatus(CellValidationStatus.VALID);
        cell.setValidationMessage("");
    }

    static BigDecimal parseMoney(String raw) {
        String sanitized = normalizeText(raw)
            .replace(",", "")
            .replace("원", "")
            .replace("₩", "")
            .replace(" ", "");
        if (sanitized.isBlank()) return BigDecimal.ZERO;
        return new BigDecimal(sanitized);
    }

    private static String normalizeText(String raw) {
        return raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
    }
}
