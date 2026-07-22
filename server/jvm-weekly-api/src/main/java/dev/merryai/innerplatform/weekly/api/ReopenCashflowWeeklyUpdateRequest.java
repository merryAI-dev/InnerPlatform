package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ReopenCashflowWeeklyUpdateRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
    @Min(1) @Max(CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) int weekNo,
    @Min(1) long expectedRevision,
    @NotBlank @Size(max = 1_000) String reason
) {
}
