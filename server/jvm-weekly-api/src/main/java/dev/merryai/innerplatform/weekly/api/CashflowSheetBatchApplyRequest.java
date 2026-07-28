package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import dev.merryai.innerplatform.weekly.domain.CashflowFormulaValidator;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

public record CashflowSheetBatchApplyRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String sourceRevision,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String targetRevision,
    boolean replaceAllActualSources,
    @Valid CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
    @Size(max = 1000) String closedMonthChangeReason,
    @Valid @NotNull @Size(max = 288) List<CashflowOpeningBalanceCell> openingBalanceCells,
    @Valid @NotNull @Size(min = 1, max = 12) List<Month> months,
    boolean acceptFormulaMismatches
) {
    public static final int MAX_MONTH_COUNT = 12;

    public CashflowSheetBatchApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        boolean replaceAllActualSources,
        List<Month> months
    ) {
        this(idempotencyKey, sourceRevision, targetRevision, replaceAllActualSources, null, null, List.of(), months, true);
    }

    public CashflowSheetBatchApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        boolean replaceAllActualSources,
        String closedMonthChangeReason,
        List<Month> months
    ) {
        this(
            idempotencyKey,
            sourceRevision,
            targetRevision,
            replaceAllActualSources,
            null,
            closedMonthChangeReason,
            List.of(),
            months,
            true
        );
    }

    public CashflowSheetBatchApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        boolean replaceAllActualSources,
        CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
        String closedMonthChangeReason,
        List<CashflowOpeningBalanceCell> openingBalanceCells,
        List<Month> months
    ) {
        this(
            idempotencyKey,
            sourceRevision,
            targetRevision,
            replaceAllActualSources,
            settledWeekChangeConfirmation,
            closedMonthChangeReason,
            openingBalanceCells,
            months,
            true
        );
    }

    public CashflowSheetBatchApplyRequest {
        openingBalanceCells = openingBalanceCells == null ? List.of() : List.copyOf(openingBalanceCells);
        months = months == null ? List.of() : List.copyOf(months);
    }

    public Map<String, BigDecimal> calculatedOpeningBalances(String firstYearMonth) {
        if (firstYearMonth == null || !firstYearMonth.endsWith("-01")) return Map.of();
        return CashflowFormulaValidator.calculateOpeningBalances(
            openingBalanceCells.stream().map(cell -> new CashflowFormulaValidator.OpeningCell(
                cell.year(), cell.mode(), cell.cashflowLine(), cell.cellState(), cell.amount()
            )).toList(),
            Integer.parseInt(firstYearMonth.substring(0, 4))
        );
    }

    public record Month(
        @NotBlank
        @Size(min = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH, max = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH)
        @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])")
        String yearMonth,
        @NotNull @Size(min = 10, max = 10) List<Map<String, Object>> calculationChecks,
        @Valid @NotNull @Size(
            min = CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT,
            max = CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT
        )
        List<CashflowSheetLabApplyRequest.Cell> cells,
        Boolean apply
    ) {
        public Month(String yearMonth, List<CashflowSheetLabApplyRequest.Cell> cells) {
            this(yearMonth, List.of(), cells, true);
        }

        public Month(
            String yearMonth,
            List<Map<String, Object>> calculationChecks,
            List<CashflowSheetLabApplyRequest.Cell> cells
        ) {
            this(yearMonth, calculationChecks, cells, true);
        }

        public Month {
            calculationChecks = calculationChecks == null ? List.of() : List.copyOf(calculationChecks);
            apply = apply == null || apply;
        }

        public boolean shouldApply() {
            return Boolean.TRUE.equals(apply);
        }
    }

    public static NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> requireCompleteMonths(
        List<Month> months
    ) {
        if (months == null || months.isEmpty() || months.size() > MAX_MONTH_COUNT) {
            throw new IllegalArgumentException("Cashflow sheet batch must contain between one and 12 months.");
        }
        NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> cellsByMonth = new TreeMap<>();
        for (Month month : months) {
            if (month == null || month.yearMonth() == null || month.yearMonth().isBlank()) {
                throw new IllegalArgumentException("Cashflow sheet batch contains an invalid month.");
            }
            List<CashflowSheetLabApplyRequest.Cell> cells = CashflowSheetLabApplyRequest
                .requireCompleteMonth(month.cells());
            if (cellsByMonth.putIfAbsent(month.yearMonth(), cells) != null) {
                throw new IllegalArgumentException("Cashflow sheet batch contains duplicate months.");
            }
        }
        String previous = null;
        for (String yearMonth : cellsByMonth.keySet()) {
            if (previous != null && !java.time.YearMonth.parse(previous).plusMonths(1).toString().equals(yearMonth)) {
                throw new IllegalArgumentException("Cashflow sheet batch months must be contiguous.");
            }
            previous = yearMonth;
        }
        return java.util.Collections.unmodifiableNavigableMap(cellsByMonth);
    }

    public NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> requireAppliedMonths() {
        NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> complete = requireCompleteMonths(months);
        NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> applied = new TreeMap<>();
        months.stream().filter(Month::shouldApply).forEach(month -> applied.put(month.yearMonth(), complete.get(month.yearMonth())));
        if (applied.isEmpty()) throw new IllegalArgumentException("Cashflow sheet batch must apply at least one month.");
        return java.util.Collections.unmodifiableNavigableMap(applied);
    }
}
