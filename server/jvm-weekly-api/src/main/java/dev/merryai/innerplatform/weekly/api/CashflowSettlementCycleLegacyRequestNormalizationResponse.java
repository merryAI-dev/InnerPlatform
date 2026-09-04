package dev.merryai.innerplatform.weekly.api;

public record CashflowSettlementCycleLegacyRequestNormalizationResponse(
    boolean ok,
    String commandName,
    String projectId,
    String cycleYearMonth,
    String monthCloseTargetYearMonth,
    String requestId,
    long workflowRevision,
    long evidenceRevision,
    String migrationFingerprint,
    boolean migrationRequired,
    String auditId
) {}
