package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.List;

public record SaveDraftRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    Long expectedSheetVersion,
    @Size(max = WeeklyExpenseRequestLimits.MAX_SHEET_NAME_LENGTH) String sheetName,
    @Valid @NotNull @Size(max = WeeklyExpenseRequestLimits.MAX_ROW_COUNT) List<RowPatch> rows
) {
    public record RowPatch(
        @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int rowIndex,
        @Size(max = WeeklyExpenseRequestLimits.MAX_SOURCE_ID_LENGTH) String sourceTxId,
        @Size(max = WeeklyExpenseRequestLimits.MAX_ENTRY_KIND_LENGTH) String entryKind,
        @Valid @NotNull @Size(max = WeeklyExpenseRequestLimits.COLUMN_COUNT) List<CellPatch> cells
    ) {
    }

    public record CellPatch(
        @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_COLUMN_INDEX) int columnIndex,
        @Size(max = WeeklyExpenseRequestLimits.MAX_CELL_VALUE_LENGTH) String rawValue,
        Boolean userEdited
    ) {
    }
}
