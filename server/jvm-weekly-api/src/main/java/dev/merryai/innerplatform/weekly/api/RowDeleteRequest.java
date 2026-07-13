package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.List;

public record RowDeleteRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    Long expectedSheetVersion,
    @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int startRow,
    @Positive @Max(WeeklyExpenseRequestLimits.MAX_ROW_OPERATION_COUNT) int rowCount,
    @Valid @Size(max = WeeklyExpenseRequestLimits.MAX_ROW_OPERATION_COUNT) List<ExpectedRowVersion> expectedRowVersions
) {
    public record ExpectedRowVersion(
        @PositiveOrZero @Max(WeeklyExpenseRequestLimits.MAX_ROW_INDEX) int rowIndex,
        @PositiveOrZero long rowVersion
    ) {
    }
}
