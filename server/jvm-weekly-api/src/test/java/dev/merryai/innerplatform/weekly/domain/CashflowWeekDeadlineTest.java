package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class CashflowWeekDeadlineTest {

    @ParameterizedTest
    @CsvSource({
        "2026-08, 1, 2026-08-02T15:00:00Z",
        "2026-08, 2, 2026-08-06T15:00:00Z",
        "2026-08, 3, 2026-08-13T15:00:00Z",
        "2026-08, 4, 2026-08-20T15:00:00Z",
        "2026-08, 5, 2026-08-27T15:00:00Z",
        "2026-02, 5, 2026-02-26T15:00:00Z",
        "2026-03, 1, 2026-03-01T15:00:00Z",
        "2026-01, 1, 2026-01-01T15:00:00Z",
        // 2026-12-31 이 목요일이라 5주차 마감이 해를 넘긴다.
        "2026-12, 5, 2026-12-31T15:00:00Z",
    })
    void calculatesPractitionerDeadlineAcrossCalendarBoundaries(String yearMonth, int weekNo, String expected) {
        assertThat(CashflowWeekDeadline.practitionerDeadlineAt(YearMonth.parse(yearMonth), weekNo))
            .isEqualTo(Instant.parse(expected));
    }

    @Test
    void weeklyApproverDeadlineIsThePractitionerDeadlinePlusThirteenHours() {
        // 실무자 마감 금 0시 KST(= 목 15:00Z) → 승인 마감 같은 날 13:00 KST(= 04:00Z).
        Instant practitioner = CashflowWeekDeadline.practitionerDeadlineAt(YearMonth.parse("2026-08"), 4);

        assertThat(ApproverDeadlineCalculator.weekly(practitioner, Duration.ofHours(13)))
            .isEqualTo(Instant.parse("2026-08-21T04:00:00Z"));
    }

    @Test
    void rejectsWeekNumbersOutsideTheFinanceWeekRange() {
        assertThatIllegalArgumentException()
            .isThrownBy(() -> CashflowWeekDeadline.practitionerDeadlineAt(YearMonth.parse("2026-08"), 0));
        assertThatIllegalArgumentException()
            .isThrownBy(() -> CashflowWeekDeadline.practitionerDeadlineAt(YearMonth.parse("2026-08"), 6));
    }
}
