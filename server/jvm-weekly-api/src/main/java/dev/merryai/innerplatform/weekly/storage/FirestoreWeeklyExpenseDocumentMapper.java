package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.domain.CellValidationStatus;
import dev.merryai.innerplatform.weekly.domain.SpreadsheetValueType;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseCellEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseRowEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSheetEntity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class FirestoreWeeklyExpenseDocumentMapper {
    static final String SERVER_SHEET_VERSION = "serverSheetVersion";
    static final String SERVER_ROW_VERSION = "serverRowVersion";

    public WeeklyExpenseSheetEntity toSheet(
        String tenantId,
        String projectId,
        String sheetKey,
        Map<String, Object> document
    ) {
        Map<String, Object> source = document == null ? Map.of() : document;
        String id = text(source.get("id"), sheetKey);
        String name = text(source.get("name"), sheetKey);
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity(tenantId, projectId, sheetKey, name);
        sheet.restorePersistenceState(id, longValue(source.get(SERVER_SHEET_VERSION), 0));

        Object rowsValue = source.get("rows");
        if (rowsValue instanceof Collection<?> rows) {
            int fallbackRowIndex = 0;
            for (Object rowValue : rows) {
                if (!(rowValue instanceof Map<?, ?> rawRow)) {
                    fallbackRowIndex += 1;
                    continue;
                }
                Map<String, Object> rowMap = stringKeyMap(rawRow);
                int rowIndex = intValue(rowMap.get("rowIndex"), fallbackRowIndex);
                WeeklyExpenseRowEntity row = sheet.rowAt(rowIndex);
                row.restorePersistenceState(text(rowMap.get("tempId"), "row-" + rowIndex), longValue(rowMap.get(SERVER_ROW_VERSION), 0));
                row.setSourceTxId(text(rowMap.get("sourceTxId"), null));
                row.setEntryKind(text(rowMap.get("entryKind"), ""));
                row.setValidationErrorCount(intValue(rowMap.get("validationErrorCount"), 0));
                row.setReviewRequiredCount(intValue(rowMap.get("reviewRequiredCount"), 0));
                row.setDepositAmount(decimalValue(rowMap.get("depositAmount")));
                row.setRefundAmount(decimalValue(rowMap.get("refundAmount")));
                row.setExpenseAmount(decimalValue(rowMap.get("expenseAmount")));
                row.setVatInAmount(decimalValue(rowMap.get("vatInAmount")));
                row.setBankAmount(decimalValue(rowMap.get("bankAmount")));
                readCells(row, rowMap);
                fallbackRowIndex += 1;
            }
        }
        return sheet;
    }

    public Map<String, Object> toExpenseSheetDocument(
        WeeklyExpenseSheetEntity sheet,
        Map<String, Object> existingDocument,
        Instant now,
        String updatedBy
    ) {
        Map<String, Object> existing = existingDocument == null ? Map.of() : existingDocument;
        Map<String, Object> output = new LinkedHashMap<>(existing);
        output.put("tenantId", sheet.getTenantId());
        output.put("id", sheet.getSheetKey());
        output.put("projectId", sheet.getProjectId());
        output.put("name", sheet.getName());
        output.put(SERVER_SHEET_VERSION, sheet.getSheetVersion() + 1);
        output.put("updatedAt", now == null ? Instant.now().toString() : now.toString());
        if (updatedBy != null && !updatedBy.isBlank()) {
            output.put("updatedBy", updatedBy.trim());
        }
        output.putIfAbsent("createdAt", output.get("updatedAt"));
        output.put("rows", toRowDocuments(sheet, existing));
        return output;
    }

    private List<Map<String, Object>> toRowDocuments(WeeklyExpenseSheetEntity sheet, Map<String, Object> existingDocument) {
        Map<String, Map<String, Object>> existingRows = existingRowsByTempId(existingDocument.get("rows"));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (WeeklyExpenseRowEntity row : sheet.getRows()) {
            String rowId = row.getId() == null || row.getId().isBlank() ? "row-" + row.getRowIndex() : row.getId();
            Map<String, Object> output = new LinkedHashMap<>(existingRows.getOrDefault(rowId, Map.of()));
            output.put("tempId", rowId);
            output.put("rowIndex", row.getRowIndex());
            putOptional(output, "sourceTxId", row.getSourceTxId());
            putOptional(output, "entryKind", row.getEntryKind());
            output.put(SERVER_ROW_VERSION, row.getRowVersion() + 1);
            output.put("validationErrorCount", row.getValidationErrorCount());
            output.put("reviewRequiredCount", row.getReviewRequiredCount());
            output.put("depositAmount", row.getDepositAmount());
            output.put("refundAmount", row.getRefundAmount());
            output.put("expenseAmount", row.getExpenseAmount());
            output.put("vatInAmount", row.getVatInAmount());
            output.put("bankAmount", row.getBankAmount());
            output.put("cells", mergeCells(row, output.get("cells")));
            output.put("userEditedCellIndexes", mergeUserEditedCells(row, output.get("userEditedCellIndexes")));
            rows.add(output);
        }
        rows.sort(Comparator.comparingInt(row -> intValue(row.get("rowIndex"), 0)));
        return rows;
    }

    private void readCells(WeeklyExpenseRowEntity row, Map<String, Object> rowMap) {
        Set<Integer> userEdited = integerSet(rowMap.get("userEditedCellIndexes"));
        Object cells = rowMap.get("cells");
        if (cells instanceof List<?> cellList) {
            for (int columnIndex = 0; columnIndex < cellList.size(); columnIndex += 1) {
                readCell(row, columnIndex, cellList.get(columnIndex), userEdited.contains(columnIndex));
            }
            return;
        }
        if (cells instanceof Map<?, ?> cellMap) {
            for (Map.Entry<?, ?> entry : cellMap.entrySet()) {
                Integer columnIndex = integerOrNull(entry.getKey());
                if (columnIndex == null) continue;
                readCell(row, columnIndex, entry.getValue(), userEdited.contains(columnIndex));
            }
        }
    }

    private void readCell(WeeklyExpenseRowEntity row, int columnIndex, Object cellValue, boolean userEdited) {
        try {
            WeeklyExpenseCellEntity cell = row.cellAt(columnIndex);
            if (cellValue instanceof Map<?, ?> rawCell) {
                Map<String, Object> cellMap = stringKeyMap(rawCell);
                cell.restorePersistenceState(text(cellMap.get("id"), null));
                cell.setRawValue(text(cellMap.get("rawValue"), ""));
                cell.setNormalizedValue(text(cellMap.get("normalizedValue"), text(cellMap.get("rawValue"), "")));
                cell.setValueType(enumValue(SpreadsheetValueType.class, cellMap.get("valueType"), SpreadsheetValueType.TEXT));
                cell.setValidationStatus(enumValue(CellValidationStatus.class, cellMap.get("validationStatus"), CellValidationStatus.UNKNOWN));
                cell.setValidationMessage(text(cellMap.get("validationMessage"), ""));
                cell.setUserEdited(booleanValue(cellMap.get("userEdited"), userEdited));
                return;
            }
            cell.setRawValue(text(cellValue, ""));
            cell.setUserEdited(userEdited);
        } catch (IllegalArgumentException ignored) {
            // Existing settlement documents can contain columns beyond the Java validation schema.
        }
    }

    private Object mergeCells(WeeklyExpenseRowEntity row, Object existingCells) {
        if (existingCells instanceof Map<?, ?> rawMap) {
            return mergeMapCells(row, rawMap);
        }
        return mergeListCells(row, existingCells);
    }

    private List<Object> mergeListCells(WeeklyExpenseRowEntity row, Object existingCells) {
        List<Object> cells = new ArrayList<>();
        if (existingCells instanceof List<?> list) {
            cells.addAll(list);
        }
        int maxIndex = row.getCells().stream()
            .mapToInt(WeeklyExpenseCellEntity::getColumnIndex)
            .max()
            .orElse(-1);
        while (cells.size() <= maxIndex) {
            cells.add("");
        }
        for (WeeklyExpenseCellEntity cell : row.getCells()) {
            cells.set(cell.getColumnIndex(), cell.getRawValue());
        }
        return cells;
    }

    private Map<String, Object> mergeMapCells(WeeklyExpenseRowEntity row, Map<?, ?> existingCells) {
        Map<String, Object> cells = stringKeyMap(existingCells);
        for (WeeklyExpenseCellEntity cell : row.getCells()) {
            String key = String.valueOf(cell.getColumnIndex());
            Object existing = cells.get(key);
            if (existing instanceof Map<?, ?> rawCell) {
                Map<String, Object> cellMap = stringKeyMap(rawCell);
                cellMap.put("rawValue", cell.getRawValue());
                cellMap.put("normalizedValue", cell.getNormalizedValue());
                cellMap.put("valueType", cell.getValueType().name());
                cellMap.put("validationStatus", cell.getValidationStatus().name());
                cellMap.put("validationMessage", cell.getValidationMessage());
                cellMap.put("userEdited", cell.isUserEdited());
                cells.put(key, cellMap);
            } else {
                cells.put(key, cell.getRawValue());
            }
        }
        return cells;
    }

    private List<Integer> mergeUserEditedCells(WeeklyExpenseRowEntity row, Object existingEditedCells) {
        Set<Integer> indexes = integerSet(existingEditedCells);
        for (WeeklyExpenseCellEntity cell : row.getCells()) {
            if (cell.isUserEdited()) {
                indexes.add(cell.getColumnIndex());
            } else {
                indexes.remove(cell.getColumnIndex());
            }
        }
        return indexes.stream().sorted().toList();
    }

    private Map<String, Map<String, Object>> existingRowsByTempId(Object rowsValue) {
        Map<String, Map<String, Object>> rows = new LinkedHashMap<>();
        if (!(rowsValue instanceof Collection<?> rowValues)) return rows;
        int fallbackIndex = 0;
        for (Object rowValue : rowValues) {
            if (rowValue instanceof Map<?, ?> rawRow) {
                Map<String, Object> row = stringKeyMap(rawRow);
                String tempId = text(row.get("tempId"), "row-" + fallbackIndex);
                rows.put(tempId, row);
            }
            fallbackIndex += 1;
        }
        return rows;
    }

    private Set<Integer> integerSet(Object value) {
        Set<Integer> indexes = new LinkedHashSet<>();
        if (!(value instanceof Collection<?> values)) return indexes;
        for (Object item : values) {
            Integer parsed = integerOrNull(item);
            if (parsed != null && parsed >= 0) indexes.add(parsed);
        }
        return indexes;
    }

    private Map<String, Object> stringKeyMap(Map<?, ?> raw) {
        Map<String, Object> output = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            output.put(String.valueOf(entry.getKey()), entry.getValue());
        }
        return output;
    }

    private void putOptional(Map<String, Object> output, String key, String value) {
        if (value == null || value.isBlank()) {
            output.remove(key);
        } else {
            output.put(key, value);
        }
    }

    private String text(Object value, String fallback) {
        if (value == null) return fallback;
        String text = String.valueOf(value);
        return text.isBlank() ? fallback : text;
    }

    private int intValue(Object value, int fallback) {
        Integer parsed = integerOrNull(value);
        return parsed == null ? fallback : parsed;
    }

    private Integer integerOrNull(Object value) {
        if (value instanceof Number number) return number.intValue();
        if (value == null) return null;
        try {
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private long longValue(Object value, long fallback) {
        if (value instanceof Number number) return number.longValue();
        if (value == null) return fallback;
        try {
            return Long.parseLong(String.valueOf(value).trim());
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    private BigDecimal decimalValue(Object value) {
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof Number number) return BigDecimal.valueOf(number.doubleValue());
        if (value == null) return BigDecimal.ZERO;
        String text = String.valueOf(value).replace(",", "").trim();
        if (text.isBlank()) return BigDecimal.ZERO;
        try {
            return new BigDecimal(text);
        } catch (NumberFormatException error) {
            return BigDecimal.ZERO;
        }
    }

    private boolean booleanValue(Object value, boolean fallback) {
        if (value instanceof Boolean bool) return bool;
        if (value == null) return fallback;
        return Boolean.parseBoolean(String.valueOf(value));
    }

    private <T extends Enum<T>> T enumValue(Class<T> enumType, Object value, T fallback) {
        if (value == null) return fallback;
        try {
            return Enum.valueOf(enumType, String.valueOf(value).trim().toUpperCase());
        } catch (IllegalArgumentException error) {
            return fallback;
        }
    }
}
