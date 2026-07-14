package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.Locale;

public record CashflowVarianceRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @NotBlank @Size(max = 512) @Pattern(regexp = "(?!\\.{1,2}$)[^/]+") String sheetId,
    @NotNull @PositiveOrZero @Max(9_007_199_254_740_991L) Long expectedRevision,
    @NotBlank @Pattern(regexp = "FLAG|REPLY|RESOLVE") String action,
    @Size(max = 2_000) String content
) {
    public CashflowVarianceRequest {
        idempotencyKey = idempotencyKey == null ? "" : idempotencyKey.trim();
        sheetId = sheetId == null ? "" : sheetId.trim();
        action = action == null ? "" : action.trim().toUpperCase(Locale.ROOT);
        content = content == null ? "" : content.trim();
    }
}
