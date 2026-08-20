package dev.merryai.innerplatform.weekly.domain;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;

/**
 * 주간 정산 실무자 마감 규칙의 단일 소스.
 *
 * <p>원래 {@code FirestoreInheritedWeeklyExpensePersistence} 안의 private 메서드였다.
 * 그래서 직접 테스트할 수 없었고, 화면이 한 달 5주를 한 번에 그려야 하자 BFF 가 같은 규칙을
 * 따로 구현하는 사본이 생겼다. 규칙을 여기 하나로 두고 응답에 실어 보내면 사본이 필요 없다.
 *
 * <p>규칙: 그 주(월~일) 안의 목요일 자정 = 목요일 다음 날 0시 KST. 목요일이 없는 부분 주
 * (1주차가 주 후반에서 시작하거나 5주차가 월말에서 끊길 때)는 그 주 마지막 날 다음 날 0시.
 */
public final class CashflowFinanceWeekDeadline {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final int WEEK_COUNT = 5;

    private CashflowFinanceWeekDeadline() {
    }

    public static Instant of(String yearMonth, int weekNo) {
        return of(YearMonth.parse(yearMonth), weekNo);
    }

    public static Instant of(YearMonth month, int weekNo) {
        if (weekNo < 1 || weekNo > WEEK_COUNT) {
            throw new IllegalArgumentException("Finance week must be 1..5 but was " + weekNo);
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
