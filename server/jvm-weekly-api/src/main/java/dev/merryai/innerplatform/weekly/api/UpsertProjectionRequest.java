package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;

public record UpsertProjectionRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @Valid @NotNull @Size(max = WeeklyExpenseRequestLimits.MAX_ROW_OPERATION_COUNT) List<ProjectionLinePatch> lines
) {
    public record ProjectionLinePatch(
        @NotBlank
        @Size(min = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH, max = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH)
        @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])")
        String yearMonth,
        @Min(1) @Max(6) int weekNo,
        @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_CASHFLOW_LINE_LENGTH) String cashflowLine,
        @NotNull BigDecimal amount
    ) {
    }
}
