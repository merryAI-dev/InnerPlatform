package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowApplyLeaseTest {
    private static final long LEASE_MS = CashflowApplyLease.DEFAULT_LEASE_MS;
    private static final String STARTED_AT = "2026-08-06T13:00:00.000Z";
    private static final long STARTED_AT_MS = Instant.parse(STARTED_AT).toEpochMilli();

    @Test
    void fallsBackToTheDefaultWhenTheOverrideIsUnsetOrInvalid() {
        assertThat(CashflowApplyLease.leaseMs(null)).isEqualTo(LEASE_MS);
        assertThat(CashflowApplyLease.leaseMs("")).isEqualTo(LEASE_MS);
        assertThat(CashflowApplyLease.leaseMs("abc")).isEqualTo(LEASE_MS);
        assertThat(CashflowApplyLease.leaseMs("-1")).isEqualTo(LEASE_MS);
    }

    @Test
    void readsAnExplicitOverrideIncludingTheDisablingZero() {
        assertThat(CashflowApplyLease.leaseMs("60000")).isEqualTo(60_000L);
        assertThat(CashflowApplyLease.leaseMs("0")).isZero();
    }

    @Test
    void doesNotBlockWhenNoApplyIsRunning() {
        var state = read("READY", null, STARTED_AT_MS, LEASE_MS);
        assertThat(state.applying()).isFalse();
        assertThat(state.blocked()).isFalse();
        assertThat(state.expired()).isFalse();
    }

    @Test
    void blocksWhileTheLeaseIsStillHeld() {
        var state = read("APPLYING", STARTED_AT, STARTED_AT_MS + LEASE_MS - 1, LEASE_MS);
        assertThat(state.blocked()).isTrue();
        assertThat(state.expired()).isFalse();
        assertThat(state.expiresAt()).isEqualTo("2026-08-06T13:10:00Z");
    }

    @Test
    void stopsBlockingOnceTheLeaseExpires() {
        var state = read("APPLYING", STARTED_AT, STARTED_AT_MS + LEASE_MS, LEASE_MS);
        assertThat(state.expired()).isTrue();
        assertThat(state.blocked()).isFalse();
        assertThat(state.stagedRunId()).isEqualTo("run-1");
    }

    @Test
    void keepsBlockingIndefinitelyWhenTheLeaseIsDisabled() {
        var state = read("APPLYING", STARTED_AT, STARTED_AT_MS + LEASE_MS * 1000, 0);
        assertThat(state.expired()).isFalse();
        assertThat(state.blocked()).isTrue();
        assertThat(state.expiresAt()).isEmpty();
    }

    @Test
    void doesNotExpireAPublicationThatNeverRecordedAStartTime() {
        var state = read("APPLYING", "", STARTED_AT_MS + LEASE_MS * 10, LEASE_MS);
        assertThat(state.missingStartedAt()).isTrue();
        assertThat(state.expired()).isFalse();
        assertThat(state.blocked()).isTrue();
    }

    @Test
    void ignoresAnUnparsableStartTimeInsteadOfExpiringOnIt() {
        for (Object invalid : new Object[] {"not-a-date", 1, "x".repeat(100_000), "+1000000000-12-31T23:59:59.999999999Z"}) {
            var state = CashflowApplyLease.read("APPLYING", "run-1", invalid, STARTED_AT_MS + LEASE_MS * 10, LEASE_MS);
            assertThat(state.missingStartedAt()).isTrue();
            assertThat(state.blocked()).isTrue();
        }
    }

    @Test
    void acceptsTheDateOnlyFormatParsedByTheBffContract() {
        var state = read("APPLYING", "2026-08-06", STARTED_AT_MS + LEASE_MS, LEASE_MS);
        assertThat(state.expired()).isTrue();
    }

    @Test
    void normalizesStatusAndDoesNotExpireFutureStarts() {
        assertThat(read("applying", STARTED_AT, STARTED_AT_MS + LEASE_MS, LEASE_MS).expired()).isTrue();
        assertThat(read(" APPLYING ", STARTED_AT, STARTED_AT_MS + LEASE_MS, LEASE_MS).expired()).isTrue();
        assertThat(read("APPLYING", STARTED_AT, STARTED_AT_MS - 1, LEASE_MS).blocked()).isTrue();
    }

    private static CashflowApplyLease.State read(Object status, Object startedAt, long nowMs, long leaseMs) {
        return CashflowApplyLease.read(status, "run-1", startedAt, nowMs, leaseMs);
    }
}
