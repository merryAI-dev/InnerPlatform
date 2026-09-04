package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record NormalizeLegacyCashflowSettlementCycleRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Pattern(regexp = "2026-09") String cycleYearMonth,
    @Positive long expectedRequestRevision,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String expectedManifestHash,
    @NotBlank @Size(max = 1_000) String reason,
    boolean dryRun,
    @Size(max = 128) @Pattern(regexp = "|sha256:[a-f0-9]{64}") String expectedMigrationFingerprint
) {
    public NormalizeLegacyCashflowSettlementCycleRequest {
        idempotencyKey = normalize(idempotencyKey);
        cycleYearMonth = normalize(cycleYearMonth);
        expectedManifestHash = normalize(expectedManifestHash);
        reason = normalize(reason);
        expectedMigrationFingerprint = normalize(expectedMigrationFingerprint);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
