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
    @NotBlank @Size(max = 1000) String reason,
    @Size(max = 160) String requestId,
    @Pattern(regexp = "|20\\d{2}-(0[1-9]|1[0-2])") String cycleYearMonth,
    @Pattern(regexp = "|20\\d{2}-(0[1-9]|1[0-2])") String monthCloseTargetYearMonth,
    @PositiveOrZero long evidenceRevision,
    @Pattern(regexp = "|sha256:[a-f0-9]{64}") String manifestHash,
    @PositiveOrZero long expectedWorkflowRevision
) {
    public DecideCashflowMonthReopenRequest {
        decision = decision == null ? "" : decision.trim().toUpperCase(Locale.ROOT);
        reason = reason == null ? "" : reason.trim();
        requestId = normalize(requestId);
        cycleYearMonth = normalize(cycleYearMonth);
        monthCloseTargetYearMonth = normalize(monthCloseTargetYearMonth);
        manifestHash = normalize(manifestHash);
    }

    public DecideCashflowMonthReopenRequest(
        String idempotencyKey,
        String yearMonth,
        long expectedRevision,
        String decision,
        String reason
    ) {
        this(idempotencyKey, yearMonth, expectedRevision, decision, reason, "", "", "", 0, "", 0);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
