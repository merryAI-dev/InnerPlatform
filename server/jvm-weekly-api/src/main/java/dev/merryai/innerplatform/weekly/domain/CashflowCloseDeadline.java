package dev.merryai.innerplatform.weekly.domain;

import java.time.LocalDate;
import java.time.YearMonth;

/**
 * 월 결산 기한 규칙의 단일 소스.
 *
 * <p>판정 주체는 JVM 이지만, 대시보드가 모든 달을 한 번에 그려야 해서 BFF 에도 같은 규칙이
 * 필요하다. 그 "같은 규칙" 을 두 런타임이 각자 구현하면 조용히 갈린다 - SPEC-16 의 revision
 * 해시가 JVM 과 BFF 에서 갈렸던 것이 같은 종류다. 규칙을 이 클래스와
 * {@code server/bff/cashflow-close-deadline.mjs} 두 곳에만 두고, 같은 표를 양쪽 테스트에
 * 둔다 (CashflowCloseDeadlineTest / cashflow-close-deadline.test.mjs). 한쪽을 고치면
 * 다른 쪽 표가 깨지도록 한 것이다.
 *
 * <p>규칙: 대상 월의 다음 달 10일. 누적 결산 회차는 회차 월의 10일이며, 그 회차가 덮는
 * 대상 월은 직전 월이므로 두 표현은 같은 날짜를 가리킨다.
 */
public final class CashflowCloseDeadline {

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

    /** 기한 초과 여부. 확정된 달은 초과로 보지 않는다. */
    public static boolean isOverdue(YearMonth targetMonth, String status, LocalDate businessDate) {
        if (businessDate == null) return false;
        if ("CLOSED".equalsIgnoreCase(status == null ? "" : status.trim())) return false;
        return businessDate.isAfter(forTargetMonth(targetMonth));
    }
}
