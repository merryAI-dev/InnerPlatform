package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
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
    void calculatesMonthlyDeadlineAsTheStartOfTheSecondFollowingMonthInKst() {
        assertThat(ApproverDeadlineCalculator.monthly("2026-08"))
            .isEqualTo("2026-09-30T15:00:00Z");
        assertThat(ApproverDeadlineCalculator.monthly("2026-12"))
            .isEqualTo("2027-01-31T15:00:00Z");
        assertThat(ApproverDeadlineCalculator.monthly("2024-01"))
            .isEqualTo("2024-02-29T15:00:00Z");
    }

    @Test
    void isDeterministicFromInputsAlone() {
        Instant expected = Instant.parse("2026-09-30T15:00:00Z");

        for (int iteration = 0; iteration < 1_000; iteration++) {
            assertThat(ApproverDeadlineCalculator.monthly("2026-08")).isEqualTo(expected);
        }
    }

    @Test
    void rejectsInvalidYearMonthsWithoutFallback() {
        assertThatNullPointerException()
            .isThrownBy(() -> ApproverDeadlineCalculator.monthly(null));
        assertThatExceptionOfType(DateTimeParseException.class)
            .isThrownBy(() -> ApproverDeadlineCalculator.monthly(""));
        assertThatExceptionOfType(DateTimeParseException.class)
            .isThrownBy(() -> ApproverDeadlineCalculator.monthly("2026-13"));
    }
}
