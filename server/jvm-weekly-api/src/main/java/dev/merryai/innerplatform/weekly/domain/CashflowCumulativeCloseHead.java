package dev.merryai.innerplatform.weekly.domain;

import java.time.YearMonth;

/** 누적 결산 헤드 읽기 모델. 영속 인터페이스의 중첩 record 에서 도메인으로 승격. */
public record CashflowCumulativeCloseHead(
    String status,
    String fromMonth,
    String settlementMonth,
    String closedThrough,
    String rootHash,
    long headRevision
) {
    public String operationalStatus(String yearMonth) {
        YearMonth target = YearMonth.parse(yearMonth);
        if (closedThrough == null || closedThrough.isBlank()) return "OPEN";
        YearMonth horizon = YearMonth.parse(closedThrough);
        YearMonth settlement = YearMonth.parse(settlementMonth);
        return target.getYear() == settlement.getYear() && !target.isAfter(horizon)
            ? "CLOSED"
            : "OPEN";
    }
}
