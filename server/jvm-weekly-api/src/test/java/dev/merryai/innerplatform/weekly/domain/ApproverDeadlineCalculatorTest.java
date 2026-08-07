package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

class ApproverDeadlineCalculatorTest {
    @Test
    void addsThirteenHoursToTheExistingWeeklyPractitionerDeadline() {
        Instant practitionerDeadline = Instant.parse("2026-04-30T15:00:00Z");

        assertThat(ApproverDeadlineCalculator.weekly(practitionerDeadline, Duration.ofHours(13)))
            .isEqualTo("2026-05-01T04:00:00Z");
    }

    @Test
    void calculatesMonthlyDeadlineAcrossYearAndLeapYearBoundariesInKst() {
        assertThat(ApproverDeadlineCalculator.monthly("2026-12", 3))
            .isEqualTo("2027-01-13T15:00:00Z");
        assertThat(ApproverDeadlineCalculator.monthly("2024-02", 3))
            .isEqualTo("2024-03-13T15:00:00Z");
        assertThat(ApproverDeadlineCalculator.monthly("2024-02", 3).atZone(ZoneId.of("Asia/Seoul")))
            .hasToString("2024-03-14T00:00+09:00[Asia/Seoul]");
    }

    @Test
    void isDeterministicFromInputsAlone() {
        Instant expected = Instant.parse("2026-09-13T15:00:00Z");

        for (int iteration = 0; iteration < 1_000; iteration++) {
            assertThat(ApproverDeadlineCalculator.monthly("2026-08", 3)).isEqualTo(expected);
        }
    }

    @Test
    void rejectsInvalidYearMonthsWithoutFallback() {
        assertThatNullPointerException()
            .isThrownBy(() -> ApproverDeadlineCalculator.monthly(null, 3));
        assertThatExceptionOfType(DateTimeParseException.class)
            .isThrownBy(() -> ApproverDeadlineCalculator.monthly("", 3));
        assertThatExceptionOfType(DateTimeParseException.class)
            .isThrownBy(() -> ApproverDeadlineCalculator.monthly("2026-13", 3));
    }
}
