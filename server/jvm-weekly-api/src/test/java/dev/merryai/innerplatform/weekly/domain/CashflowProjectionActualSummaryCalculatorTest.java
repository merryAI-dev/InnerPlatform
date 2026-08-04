package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowProjectionActualSummaryCalculatorTest {
    @Test
    void sumsAbsoluteCellDifferencesWithoutNetCancellationThroughCurrentFinanceWeek() {
        Clock clock = Clock.fixed(Instant.parse("2026-08-19T03:00:00Z"), ZoneOffset.UTC);
        List<WeeklyExpenseProjectionEntity> projection = List.of(
            projection("2022-12", 5, "SALES_IN", 99_000_000),
            projection("2026-08", 4, "SALES_IN", 12_371_453),
            projection("2026-08", 5, "SALES_IN", 88_000_000)
        );
        List<WeeklyExpenseActualEntity> actual = List.of(
            actual("2026-08", 3, "DIRECT_COST_OUT", 6_000_000),
            actual("2026-08", 4, "SALES_IN", 0)
        );

        CashflowProjectionActualSummaryCalculator.Summary summary =
            CashflowProjectionActualSummaryCalculator.calculate("project-a", projection, actual, clock);

        assertThat(summary.fromMonth()).isEqualTo("2023-01");
        assertThat(summary.comparisonAsOfWeek())
            .isEqualTo(new CashflowProjectionActualSummaryCalculator.FinanceWeek("2026-08", 4));
        assertThat(summary.projectionAmount()).isEqualByComparingTo("12371453");
        assertThat(summary.actualAmount()).isEqualByComparingTo("6000000");
        assertThat(summary.projectionActualDifferenceAmount()).isEqualByComparingTo("6371453");
        assertThat(summary.settlementDifferenceAmount()).isEqualByComparingTo("18371453");
        assertThat(summary.settlementMatches()).isFalse();
        assertThat(summary.periods()).extracting(CashflowProjectionActualSummaryCalculator.PeriodSummary::period)
            .containsExactly("MONTH", "WEEK_1", "WEEK_2", "WEEK_3", "WEEK_4", "WEEK_5");
        assertThat(summary.periods().getFirst().projectionAmount()).isEqualByComparingTo("100371453");
        assertThat(summary.periods().getFirst().actualAmount()).isEqualByComparingTo("6000000");
        assertThat(summary.periods().getLast().projectionAmount()).isEqualByComparingTo("88000000");
    }

    @Test
    void keepsExplicitZeroAndMissingCellsNumericallyEqual() {
        Clock clock = Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC);

        CashflowProjectionActualSummaryCalculator.Summary summary =
            CashflowProjectionActualSummaryCalculator.calculate(
                "project-a",
                List.of(projection("2026-08", 1, "SALES_IN", 0)),
                List.of(),
                clock
            );

        assertThat(summary.settlementDifferenceAmount()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(summary.settlementMatches()).isTrue();
    }

    @Test
    void derivesTheBoundaryFromTheJvmClockInKst() {
        Clock justAfterKstMonthBoundary = Clock.fixed(
            Instant.parse("2026-07-31T15:00:00Z"), ZoneOffset.UTC
        );

        assertThat(CashflowProjectionActualSummaryCalculator.currentFinanceWeek(justAfterKstMonthBoundary))
            .isEqualTo(new CashflowProjectionActualSummaryCalculator.FinanceWeek("2026-08", 1));
    }

    private static WeeklyExpenseProjectionEntity projection(
        String yearMonth, int weekNo, String lineId, long amount
    ) {
        WeeklyExpenseProjectionEntity line = new WeeklyExpenseProjectionEntity(
            "tenant-a", "project-a", yearMonth, weekNo, lineId
        );
        line.setAmount(BigDecimal.valueOf(amount));
        return line;
    }

    private static WeeklyExpenseActualEntity actual(
        String yearMonth, int weekNo, String lineId, long amount
    ) {
        WeeklyExpenseActualEntity line = new WeeklyExpenseActualEntity(
            "tenant-a", "project-a", "cashflow-sheet-lab", yearMonth, weekNo, lineId
        );
        line.setAmount(BigDecimal.valueOf(amount));
        return line;
    }
}
