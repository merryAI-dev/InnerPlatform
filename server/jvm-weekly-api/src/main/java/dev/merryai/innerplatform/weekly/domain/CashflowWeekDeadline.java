package dev.merryai.innerplatform.weekly.domain;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;

/**
 * 주정산 실무자 기한 규칙의 단일 소스.
 *
 * <p>판정 주체는 JVM 이지만, 대시보드가 모든 주를 한 번에 그려야 해서 BFF 에도 같은 규칙이
 * 필요하다. 그 "같은 규칙" 을 두 런타임이 각자 구현하면 조용히 갈린다 - 월 결산 기한이
 * {@link CashflowCloseDeadline} 과 {@code server/bff/cashflow-close-deadline.mjs} 로 짝을
 * 이룬 것과 같은 구조다. 규칙을 이 클래스와 그 mjs 두 곳에만 두고, 같은 표를 양쪽 테스트에
 * 둔다 (CashflowWeekDeadlineTest / cashflow-close-deadline.test.mjs 의 FINANCE_WEEK_PARITY).
 * 한쪽을 고치면 다른 쪽 표가 깨지도록 한 것이다.
 *
 * <p>규칙: 그 주(월~일) 안의 목요일 자정 = 목요일 다음날 0시 KST. 목요일이 없는 부분 주
 * (달의 첫 주가 금~일로 시작하는 경우 등)는 그 주 마지막 날 다음날 0시. 5주차는 달의
 * 마지막 날까지를 그 주로 본다.
 */
public final class CashflowWeekDeadline {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    /** 재무 주차 수. api 의 {@code CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT} 가 이 값을 참조한다. */
    public static final int WEEK_COUNT = 5;

    private CashflowWeekDeadline() {
    }

    /** 주정산 실무자 마감 시각. 그 주 목요일 자정(다음날 0시 KST), 목요일이 없으면 주 마지막 날 다음날 0시. */
    public static Instant practitionerDeadlineAt(YearMonth month, int weekNo) {
        if (weekNo < 1 || weekNo > WEEK_COUNT) {
            throw new IllegalArgumentException("weekNo must be within 1.." + WEEK_COUNT + ": " + weekNo);
        }
        LocalDate first = month.atDay(1);
        LocalDate firstMonday = first.minusDays(first.getDayOfWeek().getValue() - 1L);
        LocalDate start = weekNo == 1 ? first : firstMonday.plusWeeks(weekNo - 1L);
        LocalDate end = weekNo == WEEK_COUNT
            ? month.atEndOfMonth()
            : firstMonday.plusWeeks(weekNo).minusDays(1);
        LocalDate thursday = start;
        while (!thursday.isAfter(end) && thursday.getDayOfWeek() != DayOfWeek.THURSDAY) {
            thursday = thursday.plusDays(1);
        }
        LocalDate deadlineDate = thursday.isAfter(end) ? end.plusDays(1) : thursday.plusDays(1);
        return deadlineDate.atStartOfDay(SEOUL).toInstant();
    }
}
