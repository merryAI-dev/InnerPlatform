package dev.merryai.innerplatform.weekly.domain;

import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.Objects;

public final class ApproverDeadlineCalculator {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private ApproverDeadlineCalculator() {
    }

    public static Instant weekly(Instant practitionerDeadline, Duration approvalDelay) {
        return Objects.requireNonNull(practitionerDeadline, "practitionerDeadline")
            .plus(Objects.requireNonNull(approvalDelay, "approvalDelay"));
    }

    public static Instant monthly(String yearMonth) {
        return YearMonth.parse(Objects.requireNonNull(yearMonth, "yearMonth"))
            .plusMonths(2)
            .atDay(1)
            .atStartOfDay(SEOUL)
            .toInstant();
    }
}
