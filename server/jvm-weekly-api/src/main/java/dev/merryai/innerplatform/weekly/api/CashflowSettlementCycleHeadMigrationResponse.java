package dev.merryai.innerplatform.weekly.api;

public record CashflowSettlementCycleHeadMigrationResponse(
    boolean ok,
    String commandName,
    String projectId,
    String closedThrough,
    String cycleYearMonth,
    String approvalVersionId,
    long headRevision,
    String migrationFingerprint,
    boolean migrationRequired,
    String auditId
) {}
