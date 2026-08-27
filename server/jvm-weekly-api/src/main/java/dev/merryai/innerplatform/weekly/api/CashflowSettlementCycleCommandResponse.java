package dev.merryai.innerplatform.weekly.api;

public record CashflowSettlementCycleCommandResponse(
    boolean ok,
    String commandName,
    String projectId,
    String cycleYearMonth,
    String monthCloseTargetYearMonth,
    String requestId,
    String businessState,
    long workflowRevision,
    long evidenceRevision,
    String manifestHash,
    String submittedAt,
    String submittedByUid,
    String approverUid,
    String decidedAt,
    String decidedByUid,
    String reason,
    String auditId
) {
}
