package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WeeklyExpenseSpreadsheetServiceTest {
    private final WeeklyExpenseSpreadsheetService service = new WeeklyExpenseSpreadsheetService(new WeeklyExpenseCellValidator());

    @Test
    void shallowPasteCopiesValuesButRevalidatesCells() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        WeeklyExpenseRowEntity source = sheet.rowAt(0);
        source.cellAt(WeeklyExpenseColumn.DATE.index()).setRawValue("2026-06-08");
        source.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).setRawValue("1,200,000");
        source.cellAt(WeeklyExpenseColumn.CASHFLOW_LINE.index()).setRawValue("");

        ClipboardPayload copied = service.copy(
            sheet,
            new SpreadsheetSelection(0, WeeklyExpenseColumn.DATE.index(), 0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()),
            ClipboardDepth.SHALLOW
        );
        PasteResult result = service.paste(sheet, new CellAddress(2, WeeklyExpenseColumn.DATE.index()), copied);

        WeeklyExpenseRowEntity target = sheet.rowAt(2);
        assertEquals("2026-06-08", target.cellAt(WeeklyExpenseColumn.DATE.index()).getNormalizedValue());
        assertEquals(new BigDecimal("1200000"), target.getExpenseAmount());
        assertTrue(result.validationIssues().stream().anyMatch(issue -> issue.code().equals("review_required")));
        assertEquals(1, target.getReviewRequiredCount());
    }

    @Test
    void deepPasteCarriesCellMetadataButNeverCopiesRowIdentity() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        WeeklyExpenseRowEntity source = sheet.rowAt(0);
        source.setSourceTxId("tx-original");
        WeeklyExpenseCellEntity amount = source.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index());
        amount.setRawValue("7000");
        amount.setNormalizedValue("7000");
        amount.setValueType(SpreadsheetValueType.NUMBER);
        amount.setValidationStatus(CellValidationStatus.VALID);
        amount.setUserEdited(true);

        ClipboardPayload copied = service.copy(
            sheet,
            new SpreadsheetSelection(0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index(), 0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()),
            ClipboardDepth.DEEP
        );
        PasteResult result = service.paste(sheet, new CellAddress(1, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()), copied);

        WeeklyExpenseRowEntity target = sheet.rowAt(1);
        assertEquals("7000", target.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).getNormalizedValue());
        assertEquals(CellValidationStatus.VALID, target.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).getValidationStatus());
        assertEquals(new BigDecimal("7000"), target.getExpenseAmount());
        assertEquals(null, target.getSourceTxId());
        assertFalse(result.hasBlockingErrors());
    }

    @Test
    void pasteTreatsClipboardValidationMetadataAsAdvisoryAndRevalidatesFromRawValue() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        ClipboardPayload payload = new ClipboardPayload(
            SpreadsheetOperationType.COPY,
            ClipboardDepth.DEEP,
            new SpreadsheetSelection(0, 0, 0, 0),
            1,
            1,
            java.util.List.of(new ClipboardCell(
                0,
                0,
                "1,000",
                "999999",
                SpreadsheetValueType.TEXT,
                CellValidationStatus.INVALID,
                "client-provided validation is advisory"
            ))
        );

        PasteResult result = service.paste(sheet, new CellAddress(0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()), payload);

        WeeklyExpenseCellEntity target = sheet.rowAt(0).cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index());
        assertEquals("1000", target.getNormalizedValue());
        assertEquals(SpreadsheetValueType.NUMBER, target.getValueType());
        assertEquals(CellValidationStatus.VALID, target.getValidationStatus());
        assertEquals(new BigDecimal("1000"), sheet.rowAt(0).getExpenseAmount());
        assertTrue(result.validationIssues().isEmpty());
    }

    @Test
    void cutClearsSourceCellsAndRecalculatesOnlyTouchedRows() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        WeeklyExpenseRowEntity row = sheet.rowAt(0);
        row.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).setRawValue("9000");
        service.paste(sheet, new CellAddress(0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()), service.copy(
            sheet,
            new SpreadsheetSelection(0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index(), 0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()),
            ClipboardDepth.SHALLOW
        ));
        assertEquals(new BigDecimal("9000"), row.getExpenseAmount());

        ClipboardPayload cut = service.cut(
            sheet,
            new SpreadsheetSelection(0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index(), 0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()),
            ClipboardDepth.SHALLOW
        );

        assertEquals(SpreadsheetOperationType.CUT, cut.operationType());
        assertEquals("", row.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).getRawValue());
        assertEquals(BigDecimal.ZERO, row.getExpenseAmount());
    }

    @Test
    void invalidNumberPasteReturnsCellLevelIssueWithoutDroppingTheRow() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        WeeklyExpenseRowEntity source = sheet.rowAt(0);
        source.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).setRawValue("not-a-number");

        PasteResult result = service.paste(sheet, new CellAddress(1, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()), service.copy(
            sheet,
            new SpreadsheetSelection(0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index(), 0, WeeklyExpenseColumn.EXPENSE_AMOUNT.index()),
            ClipboardDepth.SHALLOW
        ));

        WeeklyExpenseRowEntity target = sheet.rowAt(1);
        assertEquals(1, result.touchedCellCount());
        assertEquals(1, result.validationIssues().size());
        assertEquals(CellValidationStatus.INVALID, target.cellAt(WeeklyExpenseColumn.EXPENSE_AMOUNT.index()).getValidationStatus());
        assertEquals(1, target.getValidationErrorCount());
        assertEquals(BigDecimal.ZERO, target.getExpenseAmount());
    }

    @Test
    void rowFormulaUsesExplicitDepositWhenExpenseAndBankAmountsAreBlank() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        WeeklyExpenseRowEntity row = sheet.rowAt(0);
        row.cellAt(WeeklyExpenseColumn.DEPOSIT_AMOUNT.index()).setRawValue("500,000");

        service.validateAndRecalculateRows(sheet);

        WeeklyExpenseFormulaEngine.RowFormulaResult formula = WeeklyExpenseFormulaEngine.evaluateRow(row);
        assertEquals(new BigDecimal("500000"), formula.actualAmount());
        assertEquals(new BigDecimal("500000"), formula.cashMovement());
    }

    @Test
    void rowFormulaUsesBankMagnitudeForActualAndSignedBankForCashMovementWhenNoClassifiedAmountExists() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        WeeklyExpenseRowEntity row = sheet.rowAt(0);
        row.cellAt(WeeklyExpenseColumn.BANK_AMOUNT.index()).setRawValue("-45,000");

        service.validateAndRecalculateRows(sheet);

        WeeklyExpenseFormulaEngine.RowFormulaResult formula = WeeklyExpenseFormulaEngine.evaluateRow(row);
        assertEquals(new BigDecimal("45000"), formula.actualAmount());
        assertEquals(new BigDecimal("-45000"), formula.cashMovement());
    }

    @Test
    void rowEntityRejectsCellsOutsideTheTwentyColumnSchema() {
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "기본 탭");
        WeeklyExpenseRowEntity row = sheet.rowAt(0);

        assertThrows(IllegalArgumentException.class, () -> row.cellAt(20));
    }
}
