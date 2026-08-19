package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// 주정산 확정: 완료 요청(SUBMITTED) 된 주를 프로젝트 조직장이 잠금(LOCKED) 으로 확정한다.
public record ConfirmCashflowWeeklyUpdateRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
    @Min(1) @Max(CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) int weekNo,
    @Min(1) long expectedRevision
) {
}
