package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record TransitionCashflowSettlementStatusRequest(
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
    @NotBlank @Pattern(regexp = "MONTH|WEEK_[1-5]") String period,
    @NotBlank @Pattern(regexp = "SUBMIT|APPROVE") String action
) {
}
