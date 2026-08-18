package dev.merryai.innerplatform.weekly.domain;

import java.time.YearMonth;

/**
 * 누적 결산 잠금 판정의 단일 소스.
 *
 * <p>2026-08-14 기간 권한 계약이 정한 규칙이다. 잠금의 근거는 canonical cumulative close
 * head 의 {@code closedThrough} 하나이며, {@code monthly_closes} 는 실행 이력이라 권한
 * 판정에 쓰지 않는다. 월별 문서의 키는 회차 월이므로 그것을 데이터 월로 읽으면 아직 열려
 * 있는 달까지 잠긴다 - 실제로 라이브에서 8월 회차가 8월을 잠근 것처럼 보이는 증상이 났다.
 *
 * <p>회차 연도 밖의 달은 잠기지 않는다. 주별 블록이 프로젝트당 한 연도이고, 그 앞뒤 연도는
 * 연간 열로만 존재하기 때문이다. 계약은 그 연간형을 월별 CLOSED 로 해석하지 말라고 못
 * 박았다.
 *
 * <p>기한 규칙({@link CashflowCloseDeadline})과 같은 처방이다. 규칙을 이 클래스와
 * {@code server/bff/cashflow-close-calendar.mjs} 두 곳에만 두고, 같은 표를 양쪽 테스트에
 * 둔다 (CashflowMonthLockTest / cashflow-month-lock.test.mjs). 한쪽을 고치면 다른 쪽 표가
 * 깨지도록 한 것이다.
 */
public final class CashflowMonthLock {

    private CashflowMonthLock() {
    }

    /**
     * 이 달이 누적 결산으로 잠겼는가.
     *
     * <p>판정에 필요한 값을 하나라도 모르면 잠그지 않는다. 판정 불능과 "잠김" 은 다르며,
     * 모르는 것을 잠금으로 바꾸면 열려 있는 달의 쓰기가 막힌다.
     */
    public static boolean isLocked(YearMonth target, YearMonth settlementMonth, YearMonth closedThrough) {
        if (target == null || settlementMonth == null || closedThrough == null) return false;
        if (target.getYear() != settlementMonth.getYear()) return false;
        return !target.isAfter(closedThrough);
    }
}
