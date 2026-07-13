package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseColumn;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSheetEntity;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FirestoreWeeklyExpenseDocumentMapperTest {
    private final FirestoreWeeklyExpenseDocumentMapper mapper = new FirestoreWeeklyExpenseDocumentMapper();

    @Test
    void roundTripsCurrentExpenseSheetShapeWithoutDroppingExtendedColumnsOrReviewMetadata() {
        List<String> cells = new ArrayList<>();
        for (int index = 0; index < 27; index += 1) {
            cells.add("legacy-" + index);
        }
        cells.set(WeeklyExpenseColumn.WEEK.index(), "2026-06-W1");
        cells.set(WeeklyExpenseColumn.CASHFLOW_LINE.index(), "사업비");
        cells.set(WeeklyExpenseColumn.EXPENSE_AMOUNT.index(), "120,000");

        Map<String, Object> existingRow = new LinkedHashMap<>();
        existingRow.put("tempId", "row-001");
        existingRow.put("sourceTxId", "bank:tx-001");
        existingRow.put("entryKind", "EXPENSE");
        existingRow.put("cells", cells);
        existingRow.put("reviewHints", List.of("cashflow line needs confirmation"));
        existingRow.put("reviewRequiredCellIndexes", List.of(6, 8));
        existingRow.put("reviewStatus", "pending");
        existingRow.put("userEditedCellIndexes", List.of(8, 10, 13));

        Map<String, Object> document = new LinkedHashMap<>();
        document.put("id", "default");
        document.put("tenantId", "mysc");
        document.put("projectId", "project-a");
        document.put("name", "기본 탭");
        document.put("order", 0);
        document.put(FirestoreWeeklyExpenseDocumentMapper.SERVER_SHEET_VERSION, 4);
        document.put("rows", List.of(existingRow));

        WeeklyExpenseSheetEntity sheet = mapper.toSheet("mysc", "project-a", "default", document);
        sheet.rowAt(0).cellAt(WeeklyExpenseColumn.MEMO.index()).setRawValue("server memo");
        sheet.rowAt(0).cellAt(WeeklyExpenseColumn.MEMO.index()).setUserEdited(true);

        Map<String, Object> saved = mapper.toExpenseSheetDocument(
            sheet,
            document,
            Instant.parse("2026-06-08T00:00:00Z"),
            "pm-1"
        );

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> savedRows = (List<Map<String, Object>>) saved.get("rows");
        @SuppressWarnings("unchecked")
        List<Object> savedCells = (List<Object>) savedRows.getFirst().get("cells");

        assertThat(saved.get("id")).isEqualTo("default");
        assertThat(saved.get(FirestoreWeeklyExpenseDocumentMapper.SERVER_SHEET_VERSION)).isEqualTo(5L);
        assertThat(savedCells).hasSize(27);
        assertThat(savedCells.get(20)).isEqualTo("legacy-20");
        assertThat(savedCells.get(26)).isEqualTo("legacy-26");
        assertThat(savedCells.get(WeeklyExpenseColumn.MEMO.index())).isEqualTo("server memo");
        assertThat(savedRows.getFirst().get("reviewHints")).isEqualTo(List.of("cashflow line needs confirmation"));
        assertThat(savedRows.getFirst().get("reviewStatus")).isEqualTo("pending");
        assertThat(savedRows.getFirst().get("userEditedCellIndexes")).isEqualTo(List.of(8, 10, 13, 16));
    }

    @Test
    void roundTripsMapBasedCellsWhenLegacyDataContainsStringColumnKeys() {
        Map<String, Object> cells = new LinkedHashMap<>();
        cells.put("3", "2026-06-W2");
        cells.put("8", Map.of(
            "rawValue", "직접사업비",
            "normalizedValue", "DIRECT_COST_OUT",
            "valueType", "TEXT",
            "validationStatus", "VALID",
            "userEdited", true
        ));
        cells.put("13", "55000");
        cells.put("26", "out-of-schema-value");

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("tempId", "row-map");
        row.put("cells", cells);
        row.put("userEditedCellIndexes", List.of("3"));

        Map<String, Object> document = Map.of(
            "id", "default",
            "name", "기본 탭",
            "rows", List.of(row)
        );

        WeeklyExpenseSheetEntity sheet = mapper.toSheet("mysc", "project-a", "default", document);

        assertThat(sheet.rowAt(0).cellAt(WeeklyExpenseColumn.WEEK.index()).getRawValue()).isEqualTo("2026-06-W2");
        assertThat(sheet.rowAt(0).cellAt(WeeklyExpenseColumn.WEEK.index()).isUserEdited()).isTrue();
        assertThat(sheet.rowAt(0).cellAt(WeeklyExpenseColumn.CASHFLOW_LINE.index()).getNormalizedValue()).isEqualTo("DIRECT_COST_OUT");
        assertThat(sheet.rowAt(0).cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).getRawValue()).isEqualTo("55000");
        sheet.rowAt(0).cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).setRawValue("77000");

        Map<String, Object> saved = mapper.toExpenseSheetDocument(
            sheet,
            document,
            Instant.parse("2026-06-08T00:00:00Z"),
            "pm-1"
        );
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> savedRows = (List<Map<String, Object>>) saved.get("rows");
        @SuppressWarnings("unchecked")
        Map<String, Object> savedCells = (Map<String, Object>) savedRows.getFirst().get("cells");
        @SuppressWarnings("unchecked")
        Map<String, Object> savedCashflowCell = (Map<String, Object>) savedCells.get("8");

        assertThat(savedCells).containsEntry("26", "out-of-schema-value");
        assertThat(savedCells).containsEntry("3", "2026-06-W2");
        assertThat(savedCells).containsEntry("13", "77000");
        assertThat(savedCashflowCell).containsEntry("rawValue", "직접사업비");
        assertThat(savedCashflowCell).containsEntry("normalizedValue", "DIRECT_COST_OUT");
        assertThat(savedCashflowCell).containsEntry("validationStatus", "VALID");
    }

    @Test
    void saveDraftStyleRowsPreserveExistingTempIdAndExtendedColumnsWhenOnlyAuthorityColumnsAreSent() {
        List<String> existingCells = new ArrayList<>();
        for (int index = 0; index < 27; index += 1) {
            existingCells.add("legacy-" + index);
        }
        Map<String, Object> existingRow = new LinkedHashMap<>();
        existingRow.put("tempId", "bank-row-001");
        existingRow.put("sourceTxId", "bank:fp-001");
        existingRow.put("cells", existingCells);

        Map<String, Object> document = Map.of(
            "id", "default",
            "name", "기본 탭",
            "rows", List.of(existingRow)
        );

        WeeklyExpenseSheetEntity sheet = mapper.toSheet("mysc", "project-a", "default", document);
        sheet.getRows().clear();
        var row = sheet.rowAt(0);
        row.restorePersistenceState("bank-row-001", 0);
        row.setSourceTxId("bank:fp-001");
        for (int columnIndex = 0; columnIndex < 20; columnIndex += 1) {
            row.cellAt(columnIndex).setRawValue("draft-" + columnIndex);
        }

        Map<String, Object> saved = mapper.toExpenseSheetDocument(
            sheet,
            document,
            Instant.parse("2026-06-08T00:00:00Z"),
            "pm-1"
        );

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> savedRows = (List<Map<String, Object>>) saved.get("rows");
        @SuppressWarnings("unchecked")
        List<Object> savedCells = (List<Object>) savedRows.getFirst().get("cells");

        assertThat(savedRows.getFirst()).containsEntry("tempId", "bank-row-001");
        assertThat(savedRows.getFirst()).containsEntry("sourceTxId", "bank:fp-001");
        assertThat(savedCells).hasSize(27);
        assertThat(savedCells.get(0)).isEqualTo("draft-0");
        assertThat(savedCells.get(19)).isEqualTo("draft-19");
        assertThat(savedCells.get(20)).isEqualTo("legacy-20");
        assertThat(savedCells.get(26)).isEqualTo("legacy-26");
    }
}
