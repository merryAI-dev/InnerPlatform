package dev.merryai.innerplatform.weekly.api;

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
    @Valid @NotNull @Size(min = 32, max = 32) List<Cell> cells
) {
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
        if (cells == null || cells.size() != 32) {
            throw new IllegalArgumentException("Cashflow annual total must contain complete Projection and Actual cells.");
        }
        Map<String, Cell> cellsByKey = new LinkedHashMap<>();
        for (Cell cell : cells) {
            String lineId = CashflowLineCatalog.canonicalize(cell == null ? null : cell.cashflowLine());
            if (cell == null || lineId.isBlank() || !CashflowLineCatalog.ALL_LINES.contains(lineId)) {
                throw new IllegalArgumentException("Unsupported cashflow line.");
            }
            String mode = cell.mode() == null ? "" : cell.mode().trim().toLowerCase(Locale.ROOT);
            String state = cell.cellState() == null ? "" : cell.cellState().trim().toUpperCase(Locale.ROOT);
            if (!List.of("projection", "actual").contains(mode)) {
                throw new IllegalArgumentException("Cashflow annual mode must be projection or actual.");
            }
            if (List.of("VALUE", "ZERO").contains(state)) {
                if (cell.amount() == null) throw new IllegalArgumentException("VALUE cashflow cells require an amount.");
                try {
                    cell.amount().longValueExact();
                } catch (ArithmeticException error) {
                    throw new IllegalArgumentException("Cashflow amounts must be whole won values in the supported range.");
                }
                if ("ZERO".equals(state) && cell.amount().compareTo(BigDecimal.ZERO) != 0) {
                    throw new IllegalArgumentException("ZERO cashflow cells require an explicit zero amount.");
                }
            } else if (!"EMPTY".equals(state) || cell.amount() != null) {
                throw new IllegalArgumentException("EMPTY cashflow cells must not include an amount.");
            }
            Cell canonical = new Cell(mode, lineId, state, cell.amount(), cell.sourceCell(), cell.sourceLabel());
            if (cellsByKey.putIfAbsent(mode + ":" + lineId, canonical) != null) {
                throw new IllegalArgumentException("Cashflow annual total contains duplicate cells.");
            }
        }
        for (String mode : List.of("projection", "actual")) {
            for (String lineId : CashflowLineCatalog.ALL_LINES) {
                if (!cellsByKey.containsKey(mode + ":" + lineId)) {
                    throw new IllegalArgumentException("Cashflow annual total must contain every cashflow line.");
                }
            }
        }
        return List.copyOf(cellsByKey.values());
    }
}
