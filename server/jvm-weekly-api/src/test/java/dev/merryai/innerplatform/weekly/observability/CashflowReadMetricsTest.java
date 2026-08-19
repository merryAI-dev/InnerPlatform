package dev.merryai.innerplatform.weekly.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

class CashflowReadMetricsTest {

    @Test
    void recordsReadsFromParallelThreadsIntoTheRequestScopeAndNeverThrows() {
        assertThat(CashflowReadMetrics.current()).isNull();
        assertThatCode(() -> {
            try (CashflowReadMetrics.Scope scope = CashflowReadMetrics.begin("test.op", "req-1", "project-a")) {
                CashflowReadMetrics.recordDocGet(1_000_000L);
                CashflowReadMetrics.recordPhase("month_close", 12);
                // 병렬 읽기 스레드도 같은 요청 컨텍스트에 기록한다.
                CompletableFuture.supplyAsync(CashflowReadMetrics.propagate(() -> {
                    CashflowReadMetrics.recordQuery(2_000_000L, 7);
                    CashflowReadMetrics.recordPhase("weekly_ledger", 30);
                    return CashflowReadMetrics.current() != null;
                })).join();
                assertThat(CashflowReadMetrics.current()).isNotNull();
                scope.failed(new IllegalStateException("boom"));
            }
        }).doesNotThrowAnyException();
        // 스코프가 닫히면 컨텍스트는 사라진다.
        assertThat(CashflowReadMetrics.current()).isNull();
        // 컨텍스트 밖의 기록은 무시된다 (요청을 절대 깨뜨리지 않는다).
        assertThatCode(() -> CashflowReadMetrics.recordDocGet(1)).doesNotThrowAnyException();
    }
}
