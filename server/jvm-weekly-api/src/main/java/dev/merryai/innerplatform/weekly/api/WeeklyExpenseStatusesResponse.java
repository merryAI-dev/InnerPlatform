package dev.merryai.innerplatform.weekly.api;

import java.time.Instant;
import java.util.List;

public record WeeklyExpenseStatusesResponse(
    String projectId,
    List<WeeklyStatusLine> statuses
) {
    public record WeeklyStatusLine(
        String id,
        String projectId,
        String yearMonth,
        int weekNo,
        String state,
        boolean pmSubmitted,
        String submittedBy,
        Instant submittedAt,
        boolean adminClosed,
        String closedBy,
        Instant closedAt,
        Instant updatedAt
    ) {
    }
}
