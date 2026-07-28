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
