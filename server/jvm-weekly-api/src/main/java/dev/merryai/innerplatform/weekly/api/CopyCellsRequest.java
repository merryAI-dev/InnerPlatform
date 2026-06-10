package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.ClipboardDepth;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record CopyCellsRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    Long expectedSheetVersion,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int startRow,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_COLUMN_INDEX) int startColumn,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int endRow,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_COLUMN_INDEX) int endColumn,
    @NotNull ClipboardDepth depth
) {
}
