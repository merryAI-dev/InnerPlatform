package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.Locale;

public record DecideCashflowMonthReopenRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank
    @Size(min = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH, max = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH)
    @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])")
    String yearMonth,
    @PositiveOrZero long expectedRevision,
    @NotBlank @Pattern(regexp = "APPROVE|REJECT") String decision,
    @NotBlank @Size(max = 1000) String reason
) {
    public DecideCashflowMonthReopenRequest {
        decision = decision == null ? "" : decision.trim().toUpperCase(Locale.ROOT);
        reason = reason == null ? "" : reason.trim();
    }
}
