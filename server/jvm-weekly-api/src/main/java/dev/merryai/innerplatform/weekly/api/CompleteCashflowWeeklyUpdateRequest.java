package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CompleteCashflowWeeklyUpdateRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
    @Min(1) @Max(CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) int weekNo,
    @NotBlank @Size(max = 64) String completedAt,
    @NotBlank @Pattern(regexp = "CHANGED|NO_CHANGES") String updateResult
) {
    public CompleteCashflowWeeklyUpdateRequest(String idempotencyKey, String yearMonth, int weekNo, String completedAt) {
        this(idempotencyKey, yearMonth, weekNo, completedAt, "CHANGED");
    }
}
