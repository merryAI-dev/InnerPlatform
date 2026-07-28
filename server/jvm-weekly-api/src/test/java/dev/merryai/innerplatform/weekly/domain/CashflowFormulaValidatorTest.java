package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CashflowFormulaValidatorTest {
    @Test
    void recalculatesTotalsAndCarriesTheJvmBalanceAcrossWeeks() {
        List<CashflowFormulaValidator.Cell> cells = completeCells();
        replace(cells, "projection", 1, "SALES_IN", "VALUE", 2_000_000);
        replace(cells, "projection", 1, "DIRECT_COST_OUT", "VALUE", 1_000_000);
        replace(cells, "projection", 2, "SALES_IN", "VALUE", 100);

        List<CashflowFormulaValidator.WeeklyCheck> result = CashflowFormulaValidator.validateMonth(
            cells,
            reportedWeeks(2_000_000)
        );

        assertThat(check(result, "projection", 1)).satisfies(check -> {
            assertThat(check.openingBalance()).isEqualByComparingTo("2000000");
            assertThat(check.depositTotal()).isEqualByComparingTo("2000000");
            assertThat(check.withdrawalTotal()).isEqualByComparingTo("1000000");
            assertThat(check.balance()).isEqualByComparingTo("3000000");
        });
        assertThat(check(result, "projection", 2).balance()).isEqualByComparingTo("3000100");
    }

    @Test
    void detectsAChangedSourceWhenTheDisplayedTotalWasNotUpdated() {
        List<CashflowFormulaValidator.Cell> cells = completeCells();
        replace(cells, "projection", 1, "SALES_IN", "VALUE", 100);
        List<CashflowFormulaValidator.ReportedWeek> reported = reportedWeeks(0);
        CashflowFormulaValidator.ReportedWeek first = reported.getFirst();
        reported.set(0, new CashflowFormulaValidator.ReportedWeek(
            first.mode(), first.weekNo(), first.openingBalance(), BigDecimal.ZERO,
            first.withdrawalTotal(), first.balance(), first.sourceCells()
        ));

        CashflowFormulaValidator.WeeklyCheck result = check(
            CashflowFormulaValidator.validateMonth(cells, reported),
            "projection",
            1
        );

        assertThat(result.depositTotal()).isEqualByComparingTo("100");
        assertThat(result.depositTotalMatches()).isFalse();
    }

    @Test
    void keepsExplicitZeroValidAndRejectsDecimalWon() {
        List<CashflowFormulaValidator.Cell> cells = completeCells();
        replace(cells, "projection", 1, "SALES_IN", "ZERO", 0);
        assertThat(CashflowFormulaValidator.validateMonth(cells, reportedWeeks(0))).hasSize(10);

        replace(cells, "projection", 1, "SALES_IN", "VALUE", new BigDecimal("0.5"));
        assertThatThrownBy(() -> CashflowFormulaValidator.validateMonth(cells, reportedWeeks(0)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("whole-won");
    }

    @Test
    void acceptsNegativeCorrections() {
        List<CashflowFormulaValidator.Cell> cells = completeCells();
        replace(cells, "actual", 1, "SALES_IN", "VALUE", -100);

        CashflowFormulaValidator.WeeklyCheck result = check(
            CashflowFormulaValidator.validateMonth(cells, reportedWeeks(0)),
            "actual",
            1
        );

        assertThat(result.depositTotal()).isEqualByComparingTo("-100");
        assertThat(result.balance()).isEqualByComparingTo("-100");
    }

    @Test
    void calculatesTheFirstOpeningBalanceFromPriorYearSourceRows() {
        List<CashflowFormulaValidator.OpeningCell> cells = completeOpeningCells(2024, 2025);
        replaceOpening(cells, 2024, "projection", "SALES_IN", "VALUE", 1_000_000);
        replaceOpening(cells, 2025, "projection", "TEAM_SUPPORT_IN", "VALUE", 2_000_000);
        replaceOpening(cells, 2025, "projection", "DIRECT_COST_OUT", "VALUE", 500_000);
        replaceOpening(cells, 2025, "actual", "SALES_IN", "ZERO", 0);

        assertThat(CashflowFormulaValidator.calculateOpeningBalances(cells, 2026))
            .containsEntry("projection", BigDecimal.valueOf(2_500_000))
            .containsEntry("actual", BigDecimal.ZERO);
    }

    @Test
    void rejectsACompletelyMissingPriorYear() {
        assertThatThrownBy(() -> CashflowFormulaValidator.calculateOpeningBalances(
            completeOpeningCells(2025),
            2026
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("every source row");
    }

    @Test
    void validatesAnnualBalancesAsAContinuousChainWithoutTrustingWrongReportedBalances() {
        List<CashflowFormulaValidator.OpeningCell> cells = completeOpeningCells(2024, 2025);
        replaceOpening(cells, 2024, "projection", "SALES_IN", "VALUE", 100);
        replaceOpening(cells, 2025, "projection", "DIRECT_COST_OUT", "VALUE", 30);
        List<CashflowFormulaValidator.ReportedAnnual> reported = reportedAnnuals(2024, 2025);
        replaceReportedAnnual(reported, 2024, "projection", 100, 0, 1);
        replaceReportedAnnual(reported, 2025, "projection", 0, 30, 2);

        List<CashflowFormulaValidator.AnnualCheck> checks = CashflowFormulaValidator.validateAnnualPeriods(
            cells,
            reported,
            Map.of()
        );

        CashflowFormulaValidator.AnnualCheck year2024 = annualCheck(checks, 2024, "projection");
        assertThat(year2024.balance()).isEqualByComparingTo("100");
        assertThat(year2024.balanceMatches()).isFalse();
        CashflowFormulaValidator.AnnualCheck year2025 = annualCheck(checks, 2025, "projection");
        assertThat(year2025.openingBalance()).isEqualByComparingTo("100");
        assertThat(year2025.balance()).isEqualByComparingTo("70");
        assertThat(year2025.balanceMatches()).isFalse();
    }

    @Test
    void carriesTheCalculatedAnnualBalanceIntoTheFirstWeeklyPeriod() {
        List<CashflowFormulaValidator.OpeningCell> annualCells = completeOpeningCells(2024, 2025);
        replaceOpening(annualCells, 2024, "projection", "SALES_IN", "VALUE", 1_000_000);
        replaceOpening(annualCells, 2025, "projection", "TEAM_SUPPORT_IN", "VALUE", 1_000_000);
        List<CashflowFormulaValidator.AnnualCheck> annualChecks = CashflowFormulaValidator.validateAnnualPeriods(
            annualCells,
            reportedAnnuals(2024, 2025),
            Map.of()
        );
        Map<String, BigDecimal> opening = Map.of(
            "projection", annualCheck(annualChecks, 2025, "projection").balance(),
            "actual", annualCheck(annualChecks, 2025, "actual").balance()
        );
        List<CashflowFormulaValidator.Cell> weeklyCells = completeCells();
        replace(weeklyCells, "projection", 1, "SALES_IN", "VALUE", 100);

        CashflowFormulaValidator.WeeklyCheck firstWeek = check(
            CashflowFormulaValidator.validateMonth(weeklyCells, reportedWeeks(0), opening),
            "projection",
            1
        );

        assertThat(firstWeek.openingBalance()).isEqualByComparingTo("2000000");
        assertThat(firstWeek.balance()).isEqualByComparingTo("2000100");
    }

    private static List<CashflowFormulaValidator.Cell> completeCells() {
        List<CashflowFormulaValidator.Cell> cells = new ArrayList<>();
        for (String mode : List.of("projection", "actual")) {
            for (int weekNo = 1; weekNo <= 5; weekNo += 1) {
                for (String lineId : CashflowLineCatalog.ALL_LINES) {
                    cells.add(new CashflowFormulaValidator.Cell(mode, weekNo, lineId, "EMPTY", null));
                }
            }
        }
        return cells;
    }

    private static List<CashflowFormulaValidator.OpeningCell> completeOpeningCells(int... years) {
        List<CashflowFormulaValidator.OpeningCell> cells = new ArrayList<>();
        for (int year : years) {
            for (String mode : List.of("projection", "actual")) {
                for (String lineId : CashflowLineCatalog.ALL_LINES) {
                    cells.add(new CashflowFormulaValidator.OpeningCell(year, mode, lineId, "EMPTY", null));
                }
            }
        }
        return cells;
    }

    private static List<CashflowFormulaValidator.ReportedAnnual> reportedAnnuals(int... years) {
        List<CashflowFormulaValidator.ReportedAnnual> reported = new ArrayList<>();
        for (int year : years) {
            for (String mode : List.of("projection", "actual")) {
                reported.add(new CashflowFormulaValidator.ReportedAnnual(
                    year, mode, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, Map.of()
                ));
            }
        }
        return reported;
    }

    private static void replaceReportedAnnual(
        List<CashflowFormulaValidator.ReportedAnnual> reported,
        int year,
        String mode,
        long depositTotal,
        long withdrawalTotal,
        long balance
    ) {
        for (int index = 0; index < reported.size(); index += 1) {
            CashflowFormulaValidator.ReportedAnnual value = reported.get(index);
            if (value.year() == year && value.mode().equals(mode)) {
                reported.set(index, new CashflowFormulaValidator.ReportedAnnual(
                    year, mode, BigDecimal.valueOf(depositTotal), BigDecimal.valueOf(withdrawalTotal),
                    BigDecimal.valueOf(balance), Map.of()
                ));
                return;
            }
        }
        throw new IllegalArgumentException("Test annual report not found.");
    }

    private static CashflowFormulaValidator.AnnualCheck annualCheck(
        List<CashflowFormulaValidator.AnnualCheck> checks,
        int year,
        String mode
    ) {
        return checks.stream()
            .filter(check -> check.year() == year && check.mode().equals(mode))
            .findFirst()
            .orElseThrow();
    }

    private static void replaceOpening(
        List<CashflowFormulaValidator.OpeningCell> cells,
        int year,
        String mode,
        String lineId,
        String state,
        long amount
    ) {
        for (int index = 0; index < cells.size(); index += 1) {
            CashflowFormulaValidator.OpeningCell cell = cells.get(index);
            if (cell.year() == year && cell.mode().equals(mode) && cell.lineId().equals(lineId)) {
                cells.set(index, new CashflowFormulaValidator.OpeningCell(
                    year, mode, lineId, state, BigDecimal.valueOf(amount)
                ));
                return;
            }
        }
        throw new IllegalArgumentException("Test opening-balance cell not found.");
    }

    private static List<CashflowFormulaValidator.ReportedWeek> reportedWeeks(long openingBalance) {
        List<CashflowFormulaValidator.ReportedWeek> checks = new ArrayList<>();
        for (String mode : List.of("projection", "actual")) {
            for (int weekNo = 1; weekNo <= 5; weekNo += 1) {
                checks.add(new CashflowFormulaValidator.ReportedWeek(
                    mode,
                    weekNo,
                    BigDecimal.valueOf(openingBalance),
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    BigDecimal.valueOf(openingBalance),
                    Map.of()
                ));
            }
        }
        return checks;
    }

    private static CashflowFormulaValidator.WeeklyCheck check(
        List<CashflowFormulaValidator.WeeklyCheck> checks,
        String mode,
        int weekNo
    ) {
        return checks.stream()
            .filter(check -> check.mode().equals(mode) && check.weekNo() == weekNo)
            .findFirst()
            .orElseThrow();
    }

    private static void replace(
        List<CashflowFormulaValidator.Cell> cells,
        String mode,
        int weekNo,
        String lineId,
        String state,
        long amount
    ) {
        replace(cells, mode, weekNo, lineId, state, BigDecimal.valueOf(amount));
    }

    private static void replace(
        List<CashflowFormulaValidator.Cell> cells,
        String mode,
        int weekNo,
        String lineId,
        String state,
        BigDecimal amount
    ) {
        for (int index = 0; index < cells.size(); index += 1) {
            CashflowFormulaValidator.Cell cell = cells.get(index);
            if (cell.mode().equals(mode) && cell.weekNo() == weekNo && cell.lineId().equals(lineId)) {
                cells.set(index, new CashflowFormulaValidator.Cell(mode, weekNo, lineId, state, amount));
                return;
            }
        }
        throw new IllegalArgumentException("Test cashflow cell not found.");
    }
}
