package dev.merryai.innerplatform.weekly.api;

import java.util.List;
import java.util.Map;

public record CashflowVarianceResponse(Week week) {
    public record Week(
        String id,
        String projectId,
        String tenantId,
        Map<String, Object> varianceFlag,
        List<Map<String, Object>> varianceHistory,
        long varianceRevision,
        String updatedAt,
        String updatedByUid,
        String updatedByName
    ) {
        public Week {
            varianceFlag = varianceFlag == null ? Map.of() : Map.copyOf(varianceFlag);
            varianceHistory = varianceHistory == null
                ? List.of()
                : varianceHistory.stream().map(Map::copyOf).toList();
        }
    }
}
