package dev.merryai.innerplatform.weekly.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record CashflowAppliedCellChangesResponse(
    List<Item> items,
    String nextCursor
) {
    public record Item(
        String eventId,
        String cellId,
        String projectId,
        String yearMonth,
        int weekNo,
        String mode,
        String lineId,
        boolean beforeHadValue,
        String beforeState,
        BigDecimal beforeAmount,
        boolean afterHadValue,
        String afterState,
        BigDecimal afterAmount,
        String actorUid,
        String actorName,
        String actorEmail,
        String reason,
        String source,
        String operationType,
        String operationId,
        String auditId,
        String sourceRevision,
        String targetRevision,
        Instant createdAt
    ) {
    }
}
