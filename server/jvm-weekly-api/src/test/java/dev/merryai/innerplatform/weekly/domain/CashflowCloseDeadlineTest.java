package dev.merryai.innerplatform.weekly.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.YearMonth;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * PARITY TABLE — BFF server/bff/cashflow-close-deadline.test.mjs 와 같은 표다.
 * 한쪽 규칙을 고치면 다른 쪽 표가 깨지도록 의도적으로 중복해 둔 것이므로,
 * 값이 달라져야 한다면 반드시 두 파일을 함께 고쳐라.
 */
class CashflowCloseDeadlineTest {

    @ParameterizedTest
    @CsvSource({
        "2026-01, 2026-02-10",
        "2026-07, 2026-08-10",
        "2026-09, 2026-10-10",
        "2026-11, 2026-12-10",
        "2026-12, 2027-01-10",
        "2027-12, 2028-01-10",
        "2024-02, 2024-03-10",
    })
    void targetMonthDeadlineMatchesTheBffTable(String yearMonth, String expected) {
        assertThat(CashflowCloseDeadline.forTargetMonth(YearMonth.parse(yearMonth)))
            .isEqualTo(LocalDate.parse(expected));
    }

    @Test
    void cumulativeCycleDeadlineIsTheCycleMonthTenth() {
        assertThat(CashflowCloseDeadline.forCumulativeCycle(YearMonth.parse("2026-08")))
            .isEqualTo(LocalDate.parse("2026-08-10"));
        // 회차가 덮는 대상 월은 직전 월이므로 두 표현은 같은 날짜여야 한다.
        assertThat(CashflowCloseDeadline.forCumulativeCycle(YearMonth.parse("2026-08")))
            .isEqualTo(CashflowCloseDeadline.forTargetMonth(YearMonth.parse("2026-07")));
    }

    @Test
    void overdueOnlyAfterTheDeadlineDay() {
        YearMonth target = YearMonth.parse("2026-07");
        assertThat(CashflowCloseDeadline.isOverdue(target, "OPEN", LocalDate.parse("2026-08-09"))).isFalse();
        assertThat(CashflowCloseDeadline.isOverdue(target, "OPEN", LocalDate.parse("2026-08-10"))).isFalse();
        assertThat(CashflowCloseDeadline.isOverdue(target, "OPEN", LocalDate.parse("2026-08-11"))).isTrue();
    }

    @Test
    void closedMonthIsNeverOverdueAndMissingBusinessDateIsNotAsserted() {
        YearMonth target = YearMonth.parse("2026-07");
        assertThat(CashflowCloseDeadline.isOverdue(target, "CLOSED", LocalDate.parse("2026-12-31"))).isFalse();
        assertThat(CashflowCloseDeadline.isOverdue(target, "closed", LocalDate.parse("2026-12-31"))).isFalse();
        assertThat(CashflowCloseDeadline.isOverdue(target, "OPEN", null)).isFalse();
    }
}
