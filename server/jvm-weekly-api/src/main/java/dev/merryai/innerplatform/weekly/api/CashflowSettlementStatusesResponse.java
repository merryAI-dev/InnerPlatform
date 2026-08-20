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
        String deadlineAt,
        String approverDeadlineAt
    ) {
        public Item(
            String period,
            String status,
            String submittedAt,
            String submittedBy,
            String approvedAt,
            String approvedBy,
            long revision
        ) {
            this(period, status, submittedAt, submittedBy, approvedAt, approvedBy, revision, null, null);
        }
    }
}
