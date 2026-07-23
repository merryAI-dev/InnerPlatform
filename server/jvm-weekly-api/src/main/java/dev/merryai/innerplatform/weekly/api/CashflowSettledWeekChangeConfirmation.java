package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Exact, server-issued settlement state acknowledged by the user.
 *
 * <p>The JVM re-reads every completion record and requires an exact match before
 * changing a locked week. A naked boolean must never authorize this accounting
 * transition.</p>
 */
public record CashflowSettledWeekChangeConfirmation(
    @NotBlank @Size(max = 100) String confirmationId,
    @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String targetRevision,
    @Valid @NotNull @Size(min = 1, max = 60) List<Week> weeks
) {
    public record Week(
        @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
        @Min(1) @Max(CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) int weekNo,
        @Min(0) long completionRevision
    ) {
    }
}
