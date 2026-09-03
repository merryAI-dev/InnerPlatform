package dev.merryai.innerplatform.weekly.domain;

import java.time.LocalDate;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;

/**
 * 월 결산 기한 규칙의 단일 소스.
 *
 * <p>규칙: 대상 월의 다음 달 10일. 누적 결산 회차는 회차 월의 10일이며, 그 회차가 덮는
 * 대상 월은 직전 월이므로 두 표현은 같은 날짜를 가리킨다.
 */
public final class CashflowCloseDeadline {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private CashflowCloseDeadline() {
    }

    /** 대상 월 기준 기한. 대상 월 다음 달 10일. */
    public static LocalDate forTargetMonth(YearMonth targetMonth) {
        return targetMonth.plusMonths(1).atDay(10);
    }

    /** 누적 결산 회차 기준 기한. 회차 월의 10일 (= 직전 월을 대상 월로 본 기한). */
    public static LocalDate forCumulativeCycle(YearMonth cycleMonth) {
        return cycleMonth.atDay(10);
    }

    public static LocalDate forMonth(YearMonth cycleOrTargetMonth, boolean cumulative) {
        return cumulative ? forCumulativeCycle(cycleOrTargetMonth) : forTargetMonth(cycleOrTargetMonth);
    }

    /** 실무자 마감 시각. 대상 월 다음 달 11일 00:00 KST. */
    public static Instant settlementDeadlineAt(YearMonth targetMonth) {
        return forTargetMonth(targetMonth).plusDays(1).atStartOfDay(SEOUL).toInstant();
    }

    /** 기한 초과 여부. 확정된 달은 초과로 보지 않는다. */
    public static boolean isOverdue(YearMonth targetMonth, String status, LocalDate businessDate) {
        if (businessDate == null) return false;
        if ("CLOSED".equalsIgnoreCase(status == null ? "" : status.trim())) return false;
        return businessDate.isAfter(forTargetMonth(targetMonth));
    }
}
