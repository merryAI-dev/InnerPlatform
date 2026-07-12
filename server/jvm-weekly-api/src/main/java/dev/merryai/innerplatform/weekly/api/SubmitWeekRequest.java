package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.List;

public record SubmitWeekRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank
    @Size(min = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH, max = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH)
    @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])")
    String yearMonth,
    @Min(1) @Max(6) int weekNo,
    @Valid WeeklySheetSnapshot weeklySheet
) {
    public SubmitWeekRequest(String idempotencyKey, String yearMonth, int weekNo) {
        this(idempotencyKey, yearMonth, weekNo, null);
    }

    public record WeeklySheetSnapshot(
        @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_SOURCE_ID_LENGTH) String sheetKey,
        @PositiveOrZero Long expectedSheetVersion,
        @Size(max = WeeklyExpenseRequestLimits.MAX_SHEET_NAME_LENGTH) String sheetName,
        @Valid @jakarta.validation.constraints.NotNull
        @Size(max = WeeklyExpenseRequestLimits.MAX_ROW_COUNT)
        List<SaveDraftRequest.RowPatch> rows
    ) {
    }
}
