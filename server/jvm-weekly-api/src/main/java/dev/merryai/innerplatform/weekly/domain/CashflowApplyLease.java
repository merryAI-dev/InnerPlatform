package dev.merryai.innerplatform.weekly.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Locale;

public final class CashflowApplyLease {
    public static final long DEFAULT_LEASE_MS = 600_000L;

    private CashflowApplyLease() {}

    public static long leaseMs(String raw) {
        if (raw == null || raw.trim().isEmpty()) return DEFAULT_LEASE_MS;
        try {
            double parsed = Double.parseDouble(raw.trim());
            if (!Double.isFinite(parsed) || parsed < 0) return DEFAULT_LEASE_MS;
            return (long) Math.floor(parsed);
        } catch (NumberFormatException ignored) {
            return DEFAULT_LEASE_MS;
        }
    }

    public static State read(Object statusValue, Object stagedRunIdValue, Object applyStartedAtValue, long nowMs, long leaseMs) {
        String status = text(statusValue).toUpperCase(Locale.ROOT);
        boolean applying = "APPLYING".equals(status);
        String applyStartedAt = text(applyStartedAtValue);
        Long startedAtMs = timestampMs(applyStartedAt);
        long effectiveLeaseMs = leaseMs >= 0 ? leaseMs : DEFAULT_LEASE_MS;
        boolean leaseEnabled = effectiveLeaseMs > 0;
        boolean expired = applying
            && leaseEnabled
            && startedAtMs != null
            && nowMs - startedAtMs >= effectiveLeaseMs;
        return new State(
            status,
            applying,
            text(stagedRunIdValue),
            applyStartedAt,
            applying && leaseEnabled && startedAtMs != null
                ? Instant.ofEpochMilli(startedAtMs + effectiveLeaseMs).toString()
                : "",
            applying && startedAtMs == null,
            expired,
            applying && !expired
        );
    }

    private static String text(Object value) {
        return value instanceof String text ? text.trim() : "";
    }

    private static Long timestampMs(String value) {
        if (value.isEmpty()) return null;
        try {
            return Instant.parse(value).toEpochMilli();
        } catch (RuntimeException ignored) {}
        try {
            return LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public record State(
        String status,
        boolean applying,
        String stagedRunId,
        String applyStartedAt,
        String expiresAt,
        boolean missingStartedAt,
        boolean expired,
        boolean blocked
    ) {}
}
