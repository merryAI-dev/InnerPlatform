package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record RowInsertRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    Long expectedSheetVersion,
    @Size(max = WeeklyExpenseRequestLimits.MAX_SHEET_NAME_LENGTH) String sheetName,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int startRow,
    @Positive @Max(WeeklyExpenseRequestLimits.MAX_ROW_OPERATION_COUNT) int rowCount
) {
}
