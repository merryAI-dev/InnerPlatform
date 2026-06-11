package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record WeeklyExpenseSheetsResponse(
    boolean ok,
    String projectId,
    List<WeeklyExpenseSheetResponse> sheets,
    List<WeeklyExpenseAuditEventResponse> recentAuditEvents
) {
}
