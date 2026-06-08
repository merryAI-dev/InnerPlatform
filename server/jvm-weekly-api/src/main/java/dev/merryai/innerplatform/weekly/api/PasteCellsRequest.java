package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CellValidationStatus;
import dev.merryai.innerplatform.weekly.domain.ClipboardDepth;
import dev.merryai.innerplatform.weekly.domain.SpreadsheetValueType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.List;

public record PasteCellsRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    Long expectedSheetVersion,
    @Size(max = WeeklyExpenseRequestLimits.MAX_SHEET_NAME_LENGTH) String sheetName,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int anchorRow,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_COLUMN_INDEX) int anchorColumn,
    @Positive @Max(WeeklyExpenseRequestLimits.MAX_ROW_COUNT) int rowCount,
    @Positive @Max(WeeklyExpenseRequestLimits.COLUMN_COUNT) int columnCount,
    @NotNull ClipboardDepth depth,
    @Valid @NotNull @Size(min = 1, max = WeeklyExpenseRequestLimits.MAX_PATCH_CELL_COUNT) List<PasteCell> cells
) {
    public record PasteCell(
        @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int relativeRow,
        @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_COLUMN_INDEX) int relativeColumn,
        @Size(max = WeeklyExpenseRequestLimits.MAX_CELL_VALUE_LENGTH) String rawValue,
        @Size(max = WeeklyExpenseRequestLimits.MAX_CELL_VALUE_LENGTH) String normalizedValue,
        SpreadsheetValueType valueType,
        CellValidationStatus validationStatus,
        @Size(max = WeeklyExpenseRequestLimits.MAX_CELL_VALIDATION_MESSAGE_LENGTH) String validationMessage
    ) {
    }
}
