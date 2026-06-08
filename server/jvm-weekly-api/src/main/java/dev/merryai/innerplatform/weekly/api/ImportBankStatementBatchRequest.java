package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;

public record ImportBankStatementBatchRequest(
    @NotBlank @Size(max = 120) String idempotencyKey,
    @Size(max = 255) String uploadName,
    @NotNull @Size(min = 1, max = 80) List<@Size(max = 400) String> columns,
    @Valid @NotNull @Size(min = 1, max = 2000) List<LinePatch> lines
) {
    public record LinePatch(
        @PositiveOrZero int lineIndex,
        @NotBlank @Size(max = 200) String sourceLineKey,
        @Size(max = 40) String transactionDate,
        @Size(max = 400) String counterparty,
        @Size(max = 1000) String memo,
        BigDecimal signedAmount,
        BigDecimal balanceAfter,
        @NotNull @Size(max = 120) List<@Size(max = 4000) String> rawCells
    ) {
    }
}
