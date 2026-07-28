package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

public record CashflowOpeningBalanceCell(
    @Min(2000) @Max(2099) int year,
    @NotBlank @Pattern(regexp = "projection|actual") String mode,
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_CASHFLOW_LINE_LENGTH) String cashflowLine,
    @NotBlank @Pattern(regexp = "VALUE|ZERO|EMPTY") String cellState,
    BigDecimal amount
) {
}
