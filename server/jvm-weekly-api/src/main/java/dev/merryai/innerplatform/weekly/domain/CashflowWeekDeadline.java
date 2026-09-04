package dev.merryai.innerplatform.weekly.domain;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;

/**
 * 주정산 실무자 기한 규칙의 단일 소스.
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
