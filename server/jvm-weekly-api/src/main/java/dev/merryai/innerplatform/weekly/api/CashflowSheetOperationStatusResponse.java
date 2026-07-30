package dev.merryai.innerplatform.weekly.api;

import java.time.Instant;
import java.util.List;

public record CashflowSheetOperationStatusResponse(
    String version,
    String projectId,
    String operationType,
    String idempotencyKeyHash,
    String status,
    String sourceRevision,
    String expectedTargetRevision,
    String resultingTargetRevision,
    List<String> appliedMonths,
    List<Integer> appliedYears,
    List<AnnualRevisionEvidence> annualRevisions,
    String auditId,
    Instant completedAt
) {
    public record AnnualRevisionEvidence(int year, long revision) {
    }
}
