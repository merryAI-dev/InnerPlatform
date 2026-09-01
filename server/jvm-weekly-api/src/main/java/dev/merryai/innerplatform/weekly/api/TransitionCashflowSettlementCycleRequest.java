package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record TransitionCashflowSettlementCycleRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "WITHDRAW|REJECT") String action,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String cycleYearMonth,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String monthCloseTargetYearMonth,
    @NotBlank @Size(max = 160) String requestId,
    @Positive long evidenceRevision,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String manifestHash,
    @PositiveOrZero long expectedWorkflowRevision,
    @Size(max = 1_000) String reason
) {
    public TransitionCashflowSettlementCycleRequest {
        idempotencyKey = normalize(idempotencyKey);
        action = normalize(action);
        cycleYearMonth = normalize(cycleYearMonth);
        monthCloseTargetYearMonth = normalize(monthCloseTargetYearMonth);
        requestId = normalize(requestId);
        manifestHash = normalize(manifestHash);
        reason = normalize(reason);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
