package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class CashflowProjectionActualSummaryCalculator {
    public static final String FROM_MONTH = "2023-01";
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Seoul");

    private CashflowProjectionActualSummaryCalculator() {
    }

    public static Summary calculate(
        String projectId,
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        Clock clock
    ) {
        FinanceWeek boundary = currentFinanceWeek(clock);
        return calculate(projectId, projection, actual, boundary, boundary.yearMonth());
    }

    public static Summary calculate(
        String projectId,
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        FinanceWeek boundary
    ) {
        return calculate(projectId, projection, actual, boundary, boundary.yearMonth());
    }

    public static Summary calculate(
        String projectId,
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        FinanceWeek boundary,
        String selectedYearMonth
    ) {
        Map<CellKey, BigDecimal> projectionAmounts = new LinkedHashMap<>();
        Map<CellKey, BigDecimal> actualAmounts = new LinkedHashMap<>();
        Map<CellKey, BigDecimal> selectedProjectionAmounts = new LinkedHashMap<>();
        Map<CellKey, BigDecimal> selectedActualAmounts = new LinkedHashMap<>();
        for (WeeklyExpenseProjectionEntity line : projection == null
            ? List.<WeeklyExpenseProjectionEntity>of() : projection) {
            requireProject(projectId, line.getProjectId());
            add(projectionAmounts, line.getYearMonth(), line.getWeekNo(), line.getCashflowLine(), line.getAmount(), boundary);
            addSelected(selectedProjectionAmounts, line.getYearMonth(), line.getWeekNo(), line.getCashflowLine(), line.getAmount(), selectedYearMonth);
        }
        for (WeeklyExpenseActualEntity line : actual == null ? List.<WeeklyExpenseActualEntity>of() : actual) {
            requireProject(projectId, line.getProjectId());
            add(actualAmounts, line.getYearMonth(), line.getWeekNo(), line.getCashflowLine(), line.getAmount(), boundary);
            addSelected(selectedActualAmounts, line.getYearMonth(), line.getWeekNo(), line.getCashflowLine(), line.getAmount(), selectedYearMonth);
        }
        BigDecimal projectionTotal = BigDecimal.ZERO;
        BigDecimal actualTotal = BigDecimal.ZERO;
        BigDecimal difference = BigDecimal.ZERO;
        for (String yearMonth : monthsThrough(boundary.yearMonth())) {
            int throughWeek = yearMonth.equals(boundary.yearMonth()) ? boundary.weekNo() : 5;
            for (int weekNo = 1; weekNo <= throughWeek; weekNo += 1) {
                for (String lineId : CashflowLineCatalog.ALL_LINES) {
                    CellKey key = new CellKey(yearMonth, weekNo, lineId);
                    BigDecimal projectionAmount = projectionAmounts.getOrDefault(key, BigDecimal.ZERO);
                    BigDecimal actualAmount = actualAmounts.getOrDefault(key, BigDecimal.ZERO);
                    projectionTotal = projectionTotal.add(projectionAmount);
                    actualTotal = actualTotal.add(actualAmount);
                    difference = difference.add(projectionAmount.subtract(actualAmount).abs());
                }
            }
        }
        List<PeriodSummary> periods = java.util.stream.IntStream.rangeClosed(1, 5)
            .mapToObj(weekNo -> periodSummary("WEEK_" + weekNo, weekNo, weekNo, selectedProjectionAmounts, selectedActualAmounts))
            .toList();
        List<PeriodSummary> withMonth = new java.util.ArrayList<>();
        withMonth.add(periodSummary("MONTH", 1, 5, selectedProjectionAmounts, selectedActualAmounts));
        withMonth.addAll(periods);
        return new Summary(
            projectId, FROM_MONTH, boundary, projectionTotal, actualTotal,
            projectionTotal.subtract(actualTotal), difference, difference.signum() == 0, withMonth
        );
    }

    private static void addSelected(
        Map<CellKey, BigDecimal> target, String yearMonth, int weekNo, String rawLineId,
        BigDecimal amount, String selectedYearMonth
    ) {
        String lineId = CashflowLineCatalog.canonicalize(rawLineId);
        if (!selectedYearMonth.equals(yearMonth) || weekNo < 1 || weekNo > 5
            || !CashflowLineCatalog.ALL_LINES.contains(lineId)) return;
        target.merge(new CellKey(yearMonth, weekNo, lineId), amount == null ? BigDecimal.ZERO : amount, BigDecimal::add);
    }

    private static PeriodSummary periodSummary(
        String period, int fromWeek, int throughWeek,
        Map<CellKey, BigDecimal> projection, Map<CellKey, BigDecimal> actual
    ) {
        BigDecimal projectionTotal = BigDecimal.ZERO;
        BigDecimal actualTotal = BigDecimal.ZERO;
        for (Map.Entry<CellKey, BigDecimal> entry : projection.entrySet()) {
            if (entry.getKey().weekNo() >= fromWeek && entry.getKey().weekNo() <= throughWeek) {
                projectionTotal = projectionTotal.add(entry.getValue());
            }
        }
        for (Map.Entry<CellKey, BigDecimal> entry : actual.entrySet()) {
            if (entry.getKey().weekNo() >= fromWeek && entry.getKey().weekNo() <= throughWeek) {
                actualTotal = actualTotal.add(entry.getValue());
            }
        }
        return new PeriodSummary(period, projectionTotal, actualTotal, projectionTotal.subtract(actualTotal));
    }

    public static FinanceWeek currentFinanceWeek(Clock clock) {
        LocalDate date = LocalDate.now(clock.withZone(BUSINESS_ZONE));
        YearMonth month = YearMonth.from(date);
        int mondayOffset = month.atDay(1).getDayOfWeek().getValue() - 1;
        int rawWeek = (mondayOffset + date.getDayOfMonth() - 1) / 7 + 1;
        return new FinanceWeek(month.toString(), Math.min(rawWeek, 5));
    }

    private static void add(
        Map<CellKey, BigDecimal> target,
        String yearMonth,
        int weekNo,
        String rawLineId,
        BigDecimal amount,
        FinanceWeek boundary
    ) {
        String lineId = CashflowLineCatalog.canonicalize(rawLineId);
        if (!included(yearMonth, weekNo, boundary) || !CashflowLineCatalog.ALL_LINES.contains(lineId)) return;
        target.merge(new CellKey(yearMonth, weekNo, lineId), amount == null ? BigDecimal.ZERO : amount, BigDecimal::add);
    }

    private static boolean included(String yearMonth, int weekNo, FinanceWeek boundary) {
        if (yearMonth == null || !yearMonth.matches("20\\d{2}-(0[1-9]|1[0-2])")
            || yearMonth.compareTo(FROM_MONTH) < 0 || yearMonth.compareTo(boundary.yearMonth()) > 0
            || weekNo < 1 || weekNo > 5) return false;
        return !yearMonth.equals(boundary.yearMonth()) || weekNo <= boundary.weekNo();
    }

    private static List<String> monthsThrough(String throughMonth) {
        YearMonth start = YearMonth.parse(FROM_MONTH);
        YearMonth end = YearMonth.parse(throughMonth);
        return java.util.stream.Stream.iterate(start, month -> !month.isAfter(end), month -> month.plusMonths(1))
            .map(YearMonth::toString)
            .toList();
    }

    private static void requireProject(String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new IllegalStateException("Canonical cashflow summary source has an invalid project scope.");
        }
    }

    private record CellKey(String yearMonth, int weekNo, String lineId) {
    }

    public record FinanceWeek(String yearMonth, int weekNo) {
        public FinanceWeek {
            YearMonth parsed = YearMonth.parse(yearMonth);
            if (parsed.isBefore(YearMonth.parse(FROM_MONTH)) || parsed.getYear() > 2099 || weekNo < 1 || weekNo > 5) {
                throw new IllegalArgumentException("Cashflow comparison boundary is invalid.");
            }
        }
    }

    public record Summary(
        String projectId,
        String fromMonth,
        FinanceWeek comparisonAsOfWeek,
        BigDecimal projectionAmount,
        BigDecimal actualAmount,
        BigDecimal projectionActualDifferenceAmount,
        BigDecimal settlementDifferenceAmount,
        boolean settlementMatches,
        List<PeriodSummary> periods
    ) {
    }

    public record PeriodSummary(
        String period,
        BigDecimal projectionAmount,
        BigDecimal actualAmount,
        BigDecimal projectionActualDifferenceAmount
    ) {}
}
