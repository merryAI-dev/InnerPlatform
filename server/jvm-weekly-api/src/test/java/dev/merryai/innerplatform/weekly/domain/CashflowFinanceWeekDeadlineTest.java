package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class CashflowFinanceWeekDeadlineTest {

    /**
     * 각 줄이 서로 다른 분기를 하나씩 잡는다. 달마다 값을 늘리지 않는다 - 표가 커지면
     * 규칙을 고칠 때 사람이 생각 대신 줄을 지우게 된다.
     */
    @ParameterizedTest
    @CsvSource({
        // 1일이 월요일: 되감기 없음 + 목요일 정상
        "2026-06, 1, 2026-06-04T15:00:00Z",
        // 1일이 토요일: 1주차가 토·일 이틀뿐이라 목요일이 없다 -> 주 마지막 날 다음 날 0시
        "2026-08, 1, 2026-08-02T15:00:00Z",
        // 중간 정상 주 (라이브에서 실제로 관측된 값)
        "2026-08, 4, 2026-08-20T15:00:00Z",
        // 5주차는 월말까지 늘어난다
        "2026-08, 5, 2026-08-27T15:00:00Z",
        // 윤년 2월 월말
        "2024-02, 5, 2024-02-29T15:00:00Z",
        // 해를 넘기는 5주차 (2026-12-31 이 목요일)
        "2026-12, 5, 2026-12-31T15:00:00Z",
        // 1일이 금요일: 되감기 최대치
        "2027-01, 1, 2027-01-03T15:00:00Z",
    })
    void followsTheThursdayMidnightRuleWithASubstituteForPartialWeeks(
        String yearMonth, int weekNo, String expected
    ) {
        assertThat(CashflowFinanceWeekDeadline.of(yearMonth, weekNo)).isEqualTo(Instant.parse(expected));
    }

    @Test
    void isMidnightInSeoul() {
        assertThat(CashflowFinanceWeekDeadline.of("2026-08", 4).atZone(ZoneId.of("Asia/Seoul")))
            .hasToString("2026-08-21T00:00+09:00[Asia/Seoul]");
    }

    @Test
    void refusesWeeksOutsideTheFixedFiveWeekLayout() {
        assertThatIllegalArgumentException().isThrownBy(() -> CashflowFinanceWeekDeadline.of("2026-08", 0));
        assertThatIllegalArgumentException().isThrownBy(() -> CashflowFinanceWeekDeadline.of("2026-08", 6));
    }
}
