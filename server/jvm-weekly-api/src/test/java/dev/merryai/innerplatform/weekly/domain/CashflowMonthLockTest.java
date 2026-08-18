package dev.merryai.innerplatform.weekly.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.YearMonth;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * PARITY TABLE — BFF server/bff/cashflow-month-lock.test.mjs 와 같은 표다.
 * 한쪽 규칙을 고치면 다른 쪽 표가 깨지도록 의도적으로 중복해 둔 것이므로,
 * 값이 달라져야 한다면 반드시 두 파일을 함께 고쳐라.
 */
class CashflowMonthLockTest {

    @ParameterizedTest
    @CsvSource({
        // closedThrough, settlementMonth(회차), 대상 월, 잠김 여부
        "2026-07, 2026-08, 2026-08, false",
        "2026-07, 2026-08, 2026-07, true",
        "2026-07, 2026-08, 2026-01, true",
        "2026-07, 2026-08, 2025-12, false",
        "2026-07, 2026-08, 2024-06, false",
        "2026-06, 2026-07, 2026-07, false",
        "2026-06, 2026-07, 2026-06, true",
        "2026-12, 2027-01, 2026-12, false",
    })
    void lockMatchesTheBffTable(String closedThrough, String settlementMonth, String target, boolean expected) {
        assertThat(CashflowMonthLock.isLocked(
            YearMonth.parse(target),
            YearMonth.parse(settlementMonth),
            YearMonth.parse(closedThrough)
        )).isEqualTo(expected);
    }

    @Test
    void neverLocksTheCycleMonthItself() {
        // monthly_closes 는 회차 월을 키로 쓴다. 그것을 데이터 월로 읽으면 여기서 깨진다.
        assertThat(CashflowMonthLock.isLocked(
            YearMonth.parse("2026-08"), YearMonth.parse("2026-08"), YearMonth.parse("2026-07")
        )).isFalse();
    }

    @Test
    void neverLocksOutsideTheCycleYear() {
        // 연간 열로만 존재하는 기간을 월별 CLOSED 로 해석하면 여기서 깨진다.
        for (String yearMonth : new String[] {"2023-01", "2024-06", "2025-12"}) {
            assertThat(CashflowMonthLock.isLocked(
                YearMonth.parse(yearMonth), YearMonth.parse("2026-08"), YearMonth.parse("2026-07")
            )).isFalse();
        }
    }

    @Test
    void doesNotLockWhenTheAuthorityIsUnknown() {
        YearMonth target = YearMonth.parse("2026-07");
        assertThat(CashflowMonthLock.isLocked(target, null, YearMonth.parse("2026-07"))).isFalse();
        assertThat(CashflowMonthLock.isLocked(target, YearMonth.parse("2026-08"), null)).isFalse();
        assertThat(CashflowMonthLock.isLocked(null, YearMonth.parse("2026-08"), YearMonth.parse("2026-07"))).isFalse();
    }
}
