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

public record CashflowSheetFormulaPreflightRequest(
    @Min(2000) @Max(2099) int sourceYear,
    @Valid @NotNull @Size(min = 32, max = 288) List<CashflowOpeningBalanceCell> annualCells,
    @Valid @NotNull @Size(min = 6, max = 54) List<AnnualDerivedCell> annualDerivedCells,
    @Valid @NotNull @Size(min = 1, max = 12) List<CashflowSheetBatchApplyRequest.Month> months,
    boolean acceptFormulaMismatches
) {
    public record AnnualDerivedCell(
        @Min(2000) @Max(2099) int year,
        @NotBlank @Pattern(regexp = "ANNUAL|GRAND_TOTAL") String periodKind,
        @NotBlank @Pattern(regexp = "projection|actual") String mode,
        @NotBlank @Pattern(regexp = "depositTotal|withdrawalTotal|balance") String field,
        BigDecimal amount,
        @NotBlank @Size(max = 20) String sourceCell
    ) {
    }
}
