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

public record CashflowSheetLabApplyRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String sourceRevision,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String targetRevision,
    @NotBlank
    @Size(min = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH, max = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH)
    @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])")
    String yearMonth,
    boolean replaceAllActualSources,
    @Valid CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
    @Size(max = 1000) String closedMonthChangeReason,
    @Valid @NotNull @Size(min = 160, max = 160) List<Cell> cells
) {
    public static final int FINANCE_WEEK_COUNT = 5;
    public static final int EXPECTED_CELL_COUNT = 160;

    public CashflowSheetLabApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        String yearMonth,
        boolean replaceAllActualSources,
        List<Cell> cells
    ) {
        this(idempotencyKey, sourceRevision, targetRevision, yearMonth, replaceAllActualSources, null, null, cells);
    }

    public CashflowSheetLabApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        String yearMonth,
        boolean replaceAllActualSources,
        String closedMonthChangeReason,
        List<Cell> cells
    ) {
        this(
            idempotencyKey,
            sourceRevision,
            targetRevision,
            yearMonth,
            replaceAllActualSources,
            null,
            closedMonthChangeReason,
            cells
        );
    }

    public record Cell(
        @NotBlank @Pattern(regexp = "projection|actual") String mode,
        @Min(1) @Max(FINANCE_WEEK_COUNT) int weekNo,
        @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_CASHFLOW_LINE_LENGTH) String cashflowLine,
        @NotBlank @Pattern(regexp = "VALUE|EMPTY") String cellState,
        BigDecimal amount,
        @Size(max = 20) String sourceCell,
        @Size(max = 200) String sourceLabel
    ) {
    }

    public static List<Cell> requireCompleteMonth(List<Cell> cells) {
        if (cells == null || cells.size() != EXPECTED_CELL_COUNT) {
            throw new IllegalArgumentException(
                "Cashflow sheet month must contain exactly five weeks with complete cells (160 cells)."
            );
        }

        Map<String, Cell> cellsByKey = new LinkedHashMap<>();
        for (Cell cell : cells) {
            if (cell == null || cell.weekNo() < 1 || cell.weekNo() > FINANCE_WEEK_COUNT) {
                throw new IllegalArgumentException("Cashflow sheet month must contain exactly five weeks.");
            }
            String lineId = CashflowLineCatalog.canonicalize(cell.cashflowLine());
            if (lineId.isBlank() || !CashflowLineCatalog.ALL_LINES.contains(lineId)) {
                throw new IllegalArgumentException("Unsupported cashflow line.");
            }
            String state = cell.cellState() == null
                ? ""
                : cell.cellState().trim().toUpperCase(Locale.ROOT);
            if ("VALUE".equals(state) && cell.amount() == null) {
                throw new IllegalArgumentException("VALUE cashflow cells require an amount.");
            }
            if ("VALUE".equals(state)) {
                try {
                    cell.amount().longValueExact();
                } catch (ArithmeticException error) {
                    throw new IllegalArgumentException(
                        "Cashflow amounts must be whole won values in the supported range."
                    );
                }
            }
            if ("EMPTY".equals(state) && cell.amount() != null) {
                throw new IllegalArgumentException("EMPTY cashflow cells must not include an amount.");
            }
            if (!"VALUE".equals(state) && !"EMPTY".equals(state)) {
                throw new IllegalArgumentException("Cashflow cellState must be VALUE or EMPTY.");
            }

            Cell canonical = new Cell(
                cell.mode(),
                cell.weekNo(),
                lineId,
                state,
                cell.amount(),
                cell.sourceCell(),
                cell.sourceLabel()
            );
            String key = canonical.mode() + ":" + canonical.weekNo() + ":" + canonical.cashflowLine();
            if (cellsByKey.putIfAbsent(key, canonical) != null) {
                throw new IllegalArgumentException("Cashflow sheet month contains duplicate cells.");
            }
        }

        for (int weekNo = 1; weekNo <= FINANCE_WEEK_COUNT; weekNo += 1) {
            for (String mode : List.of("projection", "actual")) {
                for (String lineId : CashflowLineCatalog.ALL_LINES) {
                    if (!cellsByKey.containsKey(mode + ":" + weekNo + ":" + lineId)) {
                        throw new IllegalArgumentException(
                            "Cashflow sheet month must contain complete cells for exactly five weeks."
                        );
                    }
                }
            }
        }
        return List.copyOf(cellsByKey.values());
    }
}
