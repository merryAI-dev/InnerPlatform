package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class CashflowFormulaValidator {
    private CashflowFormulaValidator() {
    }

    public static List<WeeklyCheck> validateMonth(
        List<Cell> cells,
        List<ReportedWeek> reportedWeeks
    ) {
        return validateMonth(cells, reportedWeeks, Map.of());
    }

    public static List<WeeklyCheck> validateMonth(
        List<Cell> cells,
        List<ReportedWeek> reportedWeeks,
        Map<String, BigDecimal> openingBalances
    ) {
        Map<String, Cell> cellsByKey = new LinkedHashMap<>();
        for (Cell cell : cells) {
            String mode = normalizeMode(cell.mode());
            String lineId = CashflowLineCatalog.canonicalize(cell.lineId());
            if (!List.of("projection", "actual").contains(mode)
                || cell.weekNo() < 1 || cell.weekNo() > 5
                || !CashflowLineCatalog.ALL_LINES.contains(lineId)) {
                throw new IllegalArgumentException("Cashflow formula input contains an unsupported cell.");
            }
            amount(cell);
            String state = cell.state().trim().toUpperCase(Locale.ROOT);
            Cell canonical = new Cell(
                mode,
                cell.weekNo(),
                lineId,
                state,
                "EMPTY".equals(state) ? null : cell.amount()
            );
            if (cellsByKey.putIfAbsent(key(mode, cell.weekNo(), lineId), canonical) != null) {
                throw new IllegalArgumentException("Cashflow formula input contains duplicate cells.");
            }
        }

        Map<String, ReportedWeek> reportedByKey = new LinkedHashMap<>();
        for (ReportedWeek reported : reportedWeeks) {
            String mode = normalizeMode(reported.mode());
            ReportedWeek canonical = new ReportedWeek(
                mode,
                reported.weekNo(),
                reported.openingBalance(),
                reported.depositTotal(),
                reported.withdrawalTotal(),
                reported.balance(),
                reported.sourceCells() == null ? Map.of() : Map.copyOf(reported.sourceCells())
            );
            if (reportedByKey.putIfAbsent(mode + ":" + reported.weekNo(), canonical) != null) {
                throw new IllegalArgumentException("Cashflow formula input contains duplicate reported weeks.");
            }
        }

        List<WeeklyCheck> results = new ArrayList<>(10);
        for (String mode : List.of("projection", "actual")) {
            BigDecimal priorBalance = null;
            for (int weekNo = 1; weekNo <= 5; weekNo += 1) {
                ReportedWeek reported = reportedByKey.get(mode + ":" + weekNo);
                if (reported == null) {
                    throw new IllegalArgumentException("Cashflow formula input must contain ten reported weeks.");
                }
                if (weekNo == 1) {
                    priorBalance = requiredWholeWon(
                        openingBalances.containsKey(mode) ? openingBalances.get(mode) : reported.openingBalance(),
                        "opening balance"
                    );
                }

                BigDecimal depositTotal = total(cellsByKey, mode, weekNo, CashflowLineCatalog.IN_LINES);
                BigDecimal withdrawalTotal = total(cellsByKey, mode, weekNo, CashflowLineCatalog.OUT_LINES);
                BigDecimal balance = priorBalance.add(depositTotal).subtract(withdrawalTotal);
                results.add(new WeeklyCheck(
                    mode,
                    weekNo,
                    priorBalance,
                    depositTotal,
                    withdrawalTotal,
                    balance,
                    matches(reported.depositTotal(), depositTotal),
                    matches(reported.withdrawalTotal(), withdrawalTotal),
                    matches(reported.balance(), balance),
                    reported.sourceCells()
                ));
                priorBalance = balance;
            }
        }
        return results.stream()
            .sorted(Comparator.comparingInt(WeeklyCheck::weekNo).thenComparing(WeeklyCheck::mode))
            .toList();
    }

    private static BigDecimal total(
        Map<String, Cell> cells,
        String mode,
        int weekNo,
        java.util.Set<String> lineIds
    ) {
        BigDecimal total = BigDecimal.ZERO;
        for (String lineId : lineIds) {
            Cell cell = cells.get(key(mode, weekNo, lineId));
            if (cell == null) throw new IllegalArgumentException("Cashflow formula input is incomplete.");
            total = total.add(amount(cell));
        }
        return total;
    }

    private static BigDecimal amount(Cell cell) {
        String state = cell.state() == null ? "" : cell.state().trim().toUpperCase(Locale.ROOT);
        if ("EMPTY".equals(state)) {
            if (cell.amount() != null) throw new IllegalArgumentException("EMPTY cashflow cells must not include an amount.");
            return BigDecimal.ZERO;
        }
        if (!List.of("VALUE", "ZERO").contains(state) || cell.amount() == null) {
            throw new IllegalArgumentException("Cashflow source value is invalid.");
        }
        BigDecimal value = requiredWholeWon(cell.amount(), "cashflow amount");
        if ("ZERO".equals(state) && value.signum() != 0) {
            throw new IllegalArgumentException("ZERO cashflow cells require zero.");
        }
        return value;
    }

    private static BigDecimal requiredWholeWon(BigDecimal value, String field) {
        if (value == null) throw new IllegalArgumentException("Cashflow " + field + " is required.");
        try {
            value.longValueExact();
        } catch (ArithmeticException error) {
            throw new IllegalArgumentException("Cashflow " + field + " must be a whole-won value.");
        }
        return value.stripTrailingZeros();
    }

    private static Boolean matches(BigDecimal reported, BigDecimal calculated) {
        if (reported == null) return null;
        return requiredWholeWon(reported, "reported value").compareTo(calculated) == 0;
    }

    private static String normalizeMode(String mode) {
        return mode == null ? "" : mode.trim().toLowerCase(Locale.ROOT);
    }

    private static String key(String mode, int weekNo, String lineId) {
        return mode + ":" + weekNo + ":" + lineId;
    }

    public record Cell(String mode, int weekNo, String lineId, String state, BigDecimal amount) {
    }

    public record ReportedWeek(
        String mode,
        int weekNo,
        BigDecimal openingBalance,
        BigDecimal depositTotal,
        BigDecimal withdrawalTotal,
        BigDecimal balance,
        Map<String, String> sourceCells
    ) {
    }

    public record WeeklyCheck(
        String mode,
        int weekNo,
        BigDecimal openingBalance,
        BigDecimal depositTotal,
        BigDecimal withdrawalTotal,
        BigDecimal balance,
        Boolean depositTotalMatches,
        Boolean withdrawalTotalMatches,
        Boolean balanceMatches,
        Map<String, String> sourceCells
    ) {
    }
}
