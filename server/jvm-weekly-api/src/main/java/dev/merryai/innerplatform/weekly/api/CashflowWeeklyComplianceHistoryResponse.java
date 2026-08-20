package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowWeeklyComplianceHistoryResponse(
    List<Item> items,
    String nextCursor,
    long onTimeCount,
    long missedCount
) {
    public record Item(
        String yearMonth,
        int weekNo,
        String deadline,
        // 조직장 확정 마감(실무자 마감 +13시간). 표시 전용 - 미준수 누적 대상이 아니다.
        String approverDeadline,
        String status,
        String completedAt,
        String completedBy,
        String operationId,
        String auditId,
        String updateResult,
        String lockState
    ) {}
}
