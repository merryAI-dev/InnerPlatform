package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthCellSet;
import dev.merryai.innerplatform.weekly.domain.CashflowFormulaValidator;
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
    @Valid @NotNull @Size(max = 288) List<CashflowOpeningBalanceCell> openingBalanceCells,
    @NotNull @Size(min = 10, max = 10) List<Map<String, Object>> calculationChecks,
    @Valid @NotNull @Size(min = 160, max = 160) List<Cell> cells,
    @Valid @NotNull @Size(max = 1) List<CashflowPendingApprovalAffectedMonth> pendingApprovalAffectedMonths,
    boolean acceptFormulaMismatches
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
        this(idempotencyKey, sourceRevision, targetRevision, yearMonth, replaceAllActualSources, null, null, List.of(), List.of(), cells, List.of(), true);
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
            List.of(),
            List.of(),
            cells,
            true
        );
    }

    public CashflowSheetLabApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        String yearMonth,
        boolean replaceAllActualSources,
        CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
        String closedMonthChangeReason,
        List<Map<String, Object>> calculationChecks,
        List<Cell> cells
    ) {
        this(
            idempotencyKey,
            sourceRevision,
            targetRevision,
            yearMonth,
            replaceAllActualSources,
            settledWeekChangeConfirmation,
            closedMonthChangeReason,
            List.of(),
            calculationChecks,
            cells,
            List.of(),
            true
        );
    }

    public CashflowSheetLabApplyRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        String yearMonth,
        boolean replaceAllActualSources,
        CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
        String closedMonthChangeReason,
        List<CashflowOpeningBalanceCell> openingBalanceCells,
        List<Map<String, Object>> calculationChecks,
        List<Cell> cells
    ) {
        this(
            idempotencyKey,
            sourceRevision,
            targetRevision,
            yearMonth,
            replaceAllActualSources,
            settledWeekChangeConfirmation,
            closedMonthChangeReason,
            openingBalanceCells,
            calculationChecks,
            cells,
            List.of(),
            true
        );
    }

    public CashflowSheetLabApplyRequest(
        String idempotencyKey, String sourceRevision, String targetRevision, String yearMonth,
        boolean replaceAllActualSources, CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
        String closedMonthChangeReason, List<CashflowOpeningBalanceCell> openingBalanceCells,
        List<Map<String, Object>> calculationChecks, List<Cell> cells, boolean acceptFormulaMismatches
    ) {
        this(idempotencyKey, sourceRevision, targetRevision, yearMonth, replaceAllActualSources,
            settledWeekChangeConfirmation, closedMonthChangeReason, openingBalanceCells, calculationChecks,
            cells, List.of(), acceptFormulaMismatches);
    }

    public CashflowSheetLabApplyRequest {
        openingBalanceCells = openingBalanceCells == null ? List.of() : List.copyOf(openingBalanceCells);
        calculationChecks = calculationChecks == null ? List.of() : List.copyOf(calculationChecks);
        pendingApprovalAffectedMonths = pendingApprovalAffectedMonths == null ? List.of() : List.copyOf(pendingApprovalAffectedMonths);
    }

    public Map<String, BigDecimal> calculatedOpeningBalances() {
        if (!yearMonth.endsWith("-01")) return Map.of();
        return CashflowFormulaValidator.calculateOpeningBalances(
            openingBalanceCells.stream().map(cell -> new CashflowFormulaValidator.OpeningCell(
                cell.year(), cell.mode(), cell.cashflowLine(), cell.cellState(), cell.amount()
            )).toList(),
            Integer.parseInt(yearMonth.substring(0, 4))
        );
    }

    public static List<Map<String, Object>> requireCompleteCalculationChecks(
        String yearMonth,
        List<Map<String, Object>> checks
    ) {
        if (checks == null || checks.size() != 10) {
            throw new IllegalArgumentException("Cashflow sheet month must contain 10 displayed calculation checks.");
        }
        Map<String, Map<String, Object>> checksByKey = new LinkedHashMap<>();
        for (Map<String, Object> check : checks) {
            if (check == null) throw new IllegalArgumentException("Cashflow calculation check is required.");
            String checkYearMonth = String.valueOf(check.getOrDefault("yearMonth", ""));
            String mode = String.valueOf(check.getOrDefault("mode", ""));
            int weekNo = check.get("weekNo") instanceof Number number ? number.intValue() : -1;
            if (!yearMonth.equals(checkYearMonth)
                || (!"projection".equals(mode) && !"actual".equals(mode))
                || weekNo < 1 || weekNo > FINANCE_WEEK_COUNT
                || !(check.get("reported") instanceof Map<?, ?> reported)
                || !reported.containsKey("openingBalance")
                || !reported.containsKey("depositTotal")
                || !reported.containsKey("withdrawalTotal")
                || !reported.containsKey("balance")) {
                throw new IllegalArgumentException("Cashflow calculation check contract is invalid.");
            }
            String key = mode + ":" + weekNo;
            if (checksByKey.putIfAbsent(key, Map.copyOf(check)) != null) {
                throw new IllegalArgumentException("Cashflow calculation checks contain duplicate weeks.");
            }
        }
        return List.copyOf(checksByKey.values());
    }

    public record Cell(
        @NotBlank @Pattern(regexp = "projection|actual") String mode,
        @Min(1) @Max(FINANCE_WEEK_COUNT) int weekNo,
        @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_CASHFLOW_LINE_LENGTH) String cashflowLine,
        @NotBlank @Pattern(regexp = "VALUE|ZERO|EMPTY") String cellState,
        BigDecimal amount,
        @Size(max = 20) String sourceCell,
        @Size(max = 200) String sourceLabel
    ) {
    }

    public static List<Cell> requireCompleteMonth(List<Cell> cells) {
        // 규칙은 domain/CashflowMonthCellSet 에 있다. 여기는 표현 <-> 도메인 매핑만 한다.
        List<CashflowMonthCellSet.Cell> domainCells = cells == null ? null : cells.stream()
            .map(cell -> cell == null ? null : new CashflowMonthCellSet.Cell(
                cell.mode(), cell.weekNo(), cell.cashflowLine(), cell.cellState(),
                cell.amount(), cell.sourceCell(), cell.sourceLabel()
            ))
            .toList();
        return CashflowMonthCellSet.requireComplete(domainCells).stream()
            .map(cell -> new Cell(
                cell.mode(), cell.weekNo(), cell.cashflowLine(), cell.cellState(),
                cell.amount(), cell.sourceCell(), cell.sourceLabel()
            ))
            .toList();
    }

    public static List<Map<String, Object>> recalculateCalculationChecks(
        String yearMonth,
        List<Cell> cells,
        List<Map<String, Object>> checks
    ) {
        return recalculateCalculationChecks(yearMonth, cells, checks, Map.of());
    }

    public static List<Map<String, Object>> recalculateCalculationChecks(
        String yearMonth,
        List<Cell> cells,
        List<Map<String, Object>> checks,
        Map<String, BigDecimal> openingBalances
    ) {
        List<Map<String, Object>> completeChecks = requireCompleteCalculationChecks(yearMonth, checks);
        List<CashflowFormulaValidator.Cell> formulaCells = requireCompleteMonth(cells).stream()
            .map(cell -> new CashflowFormulaValidator.Cell(
                cell.mode(), cell.weekNo(), cell.cashflowLine(), cell.cellState(), cell.amount()
            ))
            .toList();
        List<CashflowFormulaValidator.ReportedWeek> reportedWeeks = completeChecks.stream()
            .map(check -> {
                Map<?, ?> reported = (Map<?, ?>) check.get("reported");
                Map<String, String> sourceCells = stringMap(check.get("sourceCells"));
                return new CashflowFormulaValidator.ReportedWeek(
                    String.valueOf(check.get("mode")),
                    ((Number) check.get("weekNo")).intValue(),
                    decimal(reported.get("openingBalance")),
                    decimal(reported.get("depositTotal")),
                    decimal(reported.get("withdrawalTotal")),
                    decimal(reported.get("balance")),
                    sourceCells
                );
            })
            .toList();
        Map<String, Map<String, Object>> originals = new LinkedHashMap<>();
        completeChecks.forEach(check -> originals.put(
            check.get("mode") + ":" + check.get("weekNo"),
            check
        ));
        return CashflowFormulaValidator.validateMonth(formulaCells, reportedWeeks, openingBalances).stream()
            .map(result -> {
                Map<String, Object> recalculated = new LinkedHashMap<>(
                    originals.get(result.mode() + ":" + result.weekNo())
                );
                recalculated.put("calculated", Map.of(
                    "openingBalance", result.openingBalance(),
                    "depositTotal", result.depositTotal(),
                    "withdrawalTotal", result.withdrawalTotal(),
                    "balance", result.balance()
                ));
                Map<String, Object> matches = new LinkedHashMap<>();
                matches.put("depositTotal", result.depositTotalMatches());
                matches.put("withdrawalTotal", result.withdrawalTotalMatches());
                matches.put("balance", result.balanceMatches());
                recalculated.put("matches", matches);
                return java.util.Collections.unmodifiableMap(recalculated);
            })
            .toList();
    }

    public static Map<String, BigDecimal> closingBalances(List<Map<String, Object>> checks) {
        Map<String, BigDecimal> balances = new LinkedHashMap<>();
        checks.stream()
            .filter(check -> check.get("weekNo") instanceof Number number && number.intValue() == FINANCE_WEEK_COUNT)
            .forEach(check -> {
                Map<?, ?> calculated = check.get("calculated") instanceof Map<?, ?> value ? value : Map.of();
                balances.put(String.valueOf(check.get("mode")), decimal(calculated.get("balance")));
            });
        if (!balances.keySet().containsAll(List.of("projection", "actual"))) {
            throw new IllegalArgumentException("Cashflow calculation checks are missing closing balances.");
        }
        return Map.copyOf(balances);
    }

    private static BigDecimal decimal(Object value) {
        if (value == null) return null;
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof Number number) return new BigDecimal(number.toString());
        throw new IllegalArgumentException("Cashflow calculation check amount is invalid.");
    }

    public static List<CashflowFormulaCheckResponse> calculationCheckResponses(
        List<Map<String, Object>> checks
    ) {
        return checks.stream().map(check -> {
            Map<?, ?> reported = check.get("reported") instanceof Map<?, ?> value ? value : Map.of();
            Map<?, ?> calculated = check.get("calculated") instanceof Map<?, ?> value ? value : Map.of();
            Map<?, ?> matches = check.get("matches") instanceof Map<?, ?> value ? value : Map.of();
            return new CashflowFormulaCheckResponse(
                String.valueOf(check.getOrDefault("yearMonth", "")),
                String.valueOf(check.getOrDefault("mode", "")),
                check.get("weekNo") instanceof Number number ? number.intValue() : 0,
                amounts(reported),
                amounts(calculated),
                new CashflowFormulaCheckResponse.Matches(
                    bool(matches.get("depositTotal")),
                    bool(matches.get("withdrawalTotal")),
                    bool(matches.get("balance"))
                ),
                stringMap(check.get("sourceCells"))
            );
        }).toList();
    }

    private static CashflowFormulaCheckResponse.Amounts amounts(Map<?, ?> values) {
        return new CashflowFormulaCheckResponse.Amounts(
            decimal(values.get("openingBalance")),
            decimal(values.get("depositTotal")),
            decimal(values.get("withdrawalTotal")),
            decimal(values.get("balance"))
        );
    }

    private static Boolean bool(Object value) {
        return value instanceof Boolean bool ? bool : null;
    }

    private static Map<String, String> stringMap(Object value) {
        if (!(value instanceof Map<?, ?> source)) return Map.of();
        Map<String, String> result = new LinkedHashMap<>();
        source.forEach((key, item) -> result.put(String.valueOf(key), String.valueOf(item)));
        return Map.copyOf(result);
    }
}
