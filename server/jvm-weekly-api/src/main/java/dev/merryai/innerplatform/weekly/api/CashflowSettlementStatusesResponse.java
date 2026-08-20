package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record CashflowSettlementStatusesResponse(
    String projectId,
    String yearMonth,
    List<Item> items
) {
    public record Item(
        String period,
        String status,
        String submittedAt,
        String submittedBy,
        String approvedAt,
        String approvedBy,
        long revision,
        // 실무자 마감과 조직장 승인 마감. 규칙은 JVM 이 소유하고 화면은 받은 값을 그린다.
        String deadlineAt,
        String approverDeadlineAt
    ) {
    }
}
