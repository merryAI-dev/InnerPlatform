package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record CancelCashflowSettlementCycleRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String cycleYearMonth,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String monthCloseTargetYearMonth,
    @NotBlank @Size(max = 160) String requestId,
    @PositiveOrZero long expectedWorkflowRevision,
    @NotBlank @Size(max = 1_000) String reason
) {
    public CancelCashflowSettlementCycleRequest {
        idempotencyKey = normalize(idempotencyKey);
        cycleYearMonth = normalize(cycleYearMonth);
        monthCloseTargetYearMonth = normalize(monthCloseTargetYearMonth);
        requestId = normalize(requestId);
        reason = normalize(reason);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
