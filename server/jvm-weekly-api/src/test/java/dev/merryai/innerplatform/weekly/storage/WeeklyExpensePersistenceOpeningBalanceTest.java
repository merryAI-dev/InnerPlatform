package dev.merryai.innerplatform.weekly.storage;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WeeklyExpensePersistenceOpeningBalanceTest {
    @Test
    void priorYearsAlwaysComeFromAnnualTotalsEvenWhenWeeklyDocumentsExist() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class, CALLS_REAL_METHODS);
        when(persistence.findCashflowSheetYearTotals("tenant-a", "project-a")).thenReturn(List.of(
            annual(2024, "9000000", "9000000"),
            annual(2025, "500000", "400000"),
            annual(2027, "7000000", "7000000")
        ));

        WeeklyExpensePersistence.CashflowOpeningBalance result = persistence.findCashflowOpeningBalance(
            "tenant-a",
            "project-a",
            2026
        );

        assertThat(result.projection().amount()).isEqualByComparingTo("9500000");
        assertThat(result.actual().amount()).isEqualByComparingTo("9400000");
        assertThat(result.projection().includedYears()).containsExactly(2024, 2025);
        assertThat(result.projection().excludedWeeklyYears()).isEmpty();
        assertThat(result.projection().lineAmounts()).containsEntry("SALES_IN", new BigDecimal("9500000"));
        assertThat(result.projection().sources()).extracting(WeeklyExpensePersistence.CashflowOpeningBalance.YearSource::year)
            .containsExactly(2024, 2025);
    }

    private WeeklyExpensePersistence.CashflowSheetAnnualTotal annual(int year, String projection, String actual) {
        return new WeeklyExpensePersistence.CashflowSheetAnnualTotal(
            year,
            Map.of("SALES_IN", new BigDecimal(projection)),
            Map.of("SALES_IN", new BigDecimal(actual)),
            Map.of("SALES_IN", "VALUE"),
            Map.of("SALES_IN", "VALUE")
        );
    }
}
