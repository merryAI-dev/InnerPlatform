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
        String status,
        String completedAt,
        String completedBy,
        String operationId,
        String auditId,
        String updateResult
    ) {}
}
