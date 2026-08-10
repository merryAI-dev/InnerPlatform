package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CashflowAnnualCellSet;
import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public record CashflowSheetAnnualApplyRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String sourceRevision,
    @Min(2000) @Max(2099) int year,
    @Min(0) long expectedRevision,
    @Valid @NotNull @Size(min = 32, max = 32) List<Cell> cells,
    @Size(max = 1000) String amendmentReason,
    boolean replaceAllActualSources
) {
    public CashflowSheetAnnualApplyRequest {
        amendmentReason = amendmentReason == null ? "" : amendmentReason.trim();
    }

    public CashflowSheetAnnualApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        int year,
        long expectedRevision,
        List<Cell> cells
    ) {
        this(idempotencyKey, sourceRevision, year, expectedRevision, cells, "", false);
    }
    public record Cell(
        @NotBlank @Pattern(regexp = "projection|actual") String mode,
        @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_CASHFLOW_LINE_LENGTH) String cashflowLine,
        @NotBlank @Pattern(regexp = "VALUE|ZERO|EMPTY") String cellState,
        BigDecimal amount,
        @Size(max = 20) String sourceCell,
        @Size(max = 200) String sourceLabel
    ) {
    }

    public static List<Cell> requireCompleteYear(List<Cell> cells) {
        // 규칙은 domain/CashflowAnnualCellSet 에 있다. 여기는 표현 <-> 도메인 매핑만 한다.
        List<CashflowAnnualCellSet.Cell> domainCells = cells == null ? null : cells.stream()
            .map(cell -> cell == null ? null : new CashflowAnnualCellSet.Cell(
                cell.mode(), cell.cashflowLine(), cell.cellState(),
                cell.amount(), cell.sourceCell(), cell.sourceLabel()
            ))
            .toList();
        return CashflowAnnualCellSet.requireComplete(domainCells).stream()
            .map(cell -> new Cell(
                cell.mode(), cell.cashflowLine(), cell.cellState(),
                cell.amount(), cell.sourceCell(), cell.sourceLabel()
            ))
            .toList();
    }
}
