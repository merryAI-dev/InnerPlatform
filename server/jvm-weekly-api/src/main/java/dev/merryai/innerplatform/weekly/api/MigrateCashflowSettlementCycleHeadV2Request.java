package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record MigrateCashflowSettlementCycleHeadV2Request(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @Positive long expectedHeadRevision,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String expectedHeadRootHash,
    @NotBlank @Size(max = 1_000) String reason,
    boolean dryRun,
    @Size(max = 128) @Pattern(regexp = "|sha256:[a-f0-9]{64}") String expectedMigrationFingerprint
) {
    public MigrateCashflowSettlementCycleHeadV2Request {
        idempotencyKey = normalize(idempotencyKey);
        expectedHeadRootHash = normalize(expectedHeadRootHash);
        reason = normalize(reason);
        expectedMigrationFingerprint = normalize(expectedMigrationFingerprint);
    }

    public MigrateCashflowSettlementCycleHeadV2Request(
        String idempotencyKey,
        long expectedHeadRevision,
        String expectedHeadRootHash,
        String reason
    ) {
        this(idempotencyKey, expectedHeadRevision, expectedHeadRootHash, reason, false, "");
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
