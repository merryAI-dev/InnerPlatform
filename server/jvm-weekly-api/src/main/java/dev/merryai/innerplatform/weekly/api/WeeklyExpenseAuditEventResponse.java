package dev.merryai.innerplatform.weekly.api;

import java.time.Instant;

public record WeeklyExpenseAuditEventResponse(
    String id,
    String commandName,
    String sheetKey,
    String actorId,
    String actorEmail,
    String actorName,
    String actorRole,
    String idempotencyKey,
    Instant createdAt
) {
}
