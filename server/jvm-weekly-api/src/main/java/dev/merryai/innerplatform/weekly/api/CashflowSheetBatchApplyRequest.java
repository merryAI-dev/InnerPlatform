package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.NavigableMap;
import java.util.TreeMap;

public record CashflowSheetBatchApplyRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String sourceRevision,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String targetRevision,
    boolean replaceAllActualSources,
    @Valid CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
    @Size(max = 1000) String closedMonthChangeReason,
    @Valid @NotNull @Size(min = 1, max = 12) List<Month> months
) {
    public static final int MAX_MONTH_COUNT = 12;

    public CashflowSheetBatchApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        boolean replaceAllActualSources,
        List<Month> months
    ) {
        this(idempotencyKey, sourceRevision, targetRevision, replaceAllActualSources, null, null, months);
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
            months
        );
    }

    public record Month(
        @NotBlank
        @Size(min = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH, max = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH)
        @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])")
        String yearMonth,
        @Valid @NotNull @Size(
            min = CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT,
            max = CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT
        )
        List<CashflowSheetLabApplyRequest.Cell> cells
    ) {
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
        return java.util.Collections.unmodifiableNavigableMap(cellsByMonth);
    }
}
