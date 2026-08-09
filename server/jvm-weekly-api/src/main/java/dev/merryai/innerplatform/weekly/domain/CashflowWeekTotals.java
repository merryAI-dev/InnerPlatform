package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;

/**
 * 주차 금액 집계. 라인 합산은 도메인 규칙(IN/OUT 라인 분류에 의존)이라 컨트롤러의
 * private 메서드가 아니라 여기 있어야 한다 - BFF 의 cashflow-amounts 계열과 나란히
 * 비교할 수 있는 자리이기도 하다.
 */
public final class CashflowWeekTotals {

    private CashflowWeekTotals() {
    }

    public static BigDecimal sumLines(Map<String, BigDecimal> amounts, Set<String> lineIds) {
        return amounts.entrySet().stream()
            .filter(entry -> lineIds.contains(entry.getKey()))
            .map(entry -> safeAmount(entry.getValue()))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public static BigDecimal safeAmount(BigDecimal amount) {
        return amount == null ? BigDecimal.ZERO : amount;
    }
}
