package dev.merryai.innerplatform.weekly.observability;

import java.lang.management.ManagementFactory;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

/**
 * 8초 문제(C 단계) 측정용 개발자 로그. 로직에는 손대지 않고, 요청 하나가
 *  - Firestore 를 몇 번/얼마나 읽었는지 (문서 get / getAll / query 별 횟수·소요·문서 수)
 *  - 어떤 인스턴스에서 (Cloud Run 서비스·리비전·인스턴스 id, vCPU, 힙, 스레드, 동시 처리 수, 기동 후 경과)
 *  - 어느 단계에서 얼마나 걸렸는지
 * 를 한 줄로 남긴다. 병렬 읽기(CompletableFuture) 스레드에도 같은 컨텍스트를 물려준다.
 */
public final class CashflowReadMetrics {
    private static final System.Logger LOGGER = System.getLogger(CashflowReadMetrics.class.getName());
    private static final ThreadLocal<CashflowReadMetrics> CURRENT = new ThreadLocal<>();
    private static final AtomicInteger IN_FLIGHT = new AtomicInteger();
    private static final long STARTED_AT_MS = System.currentTimeMillis();
    private static volatile String instanceId = "";
    private static volatile boolean instanceIdResolved = false;

    private final String operation;
    private final String requestId;
    private final String projectId;
    private final long startedAtNanos = System.nanoTime();
    private final AtomicLong docGets = new AtomicLong();
    private final AtomicLong docGetNanos = new AtomicLong();
    private final AtomicLong getAlls = new AtomicLong();
    private final AtomicLong getAllNanos = new AtomicLong();
    private final AtomicLong getAllDocs = new AtomicLong();
    private final AtomicLong queries = new AtomicLong();
    private final AtomicLong queryNanos = new AtomicLong();
    private final AtomicLong queryDocs = new AtomicLong();
    private final Map<String, Long> phases = new ConcurrentHashMap<>();
    private final int inFlightAtStart;

    private CashflowReadMetrics(String operation, String requestId, String projectId) {
        this.operation = operation;
        this.requestId = requestId == null ? "" : requestId;
        this.projectId = projectId == null ? "" : projectId;
        this.inFlightAtStart = IN_FLIGHT.incrementAndGet();
    }

    /** 요청 하나의 측정을 시작한다. try-with-resources 로 닫히면 요약 한 줄을 남긴다. */
    public static Scope begin(String operation, String requestId, String projectId) {
        CashflowReadMetrics metrics = new CashflowReadMetrics(operation, requestId, projectId);
        CashflowReadMetrics previous = CURRENT.get();
        CURRENT.set(metrics);
        return new Scope(metrics, previous);
    }

    public static CashflowReadMetrics current() {
        return CURRENT.get();
    }

    /** 병렬 읽기 스레드에 현재 컨텍스트를 물려준다. */
    public static <T> Supplier<T> propagate(Supplier<T> task) {
        CashflowReadMetrics captured = CURRENT.get();
        if (captured == null) return task;
        return () -> {
            CashflowReadMetrics previous = CURRENT.get();
            CURRENT.set(captured);
            try {
                return task.get();
            } finally {
                if (previous == null) CURRENT.remove(); else CURRENT.set(previous);
            }
        };
    }

    public static void recordDocGet(long nanos) {
        CashflowReadMetrics m = CURRENT.get();
        if (m == null) return;
        m.docGets.incrementAndGet();
        m.docGetNanos.addAndGet(nanos);
    }

    public static void recordGetAll(long nanos, int docs) {
        CashflowReadMetrics m = CURRENT.get();
        if (m == null) return;
        m.getAlls.incrementAndGet();
        m.getAllNanos.addAndGet(nanos);
        m.getAllDocs.addAndGet(docs);
    }

    public static void recordQuery(long nanos, int docs) {
        CashflowReadMetrics m = CURRENT.get();
        if (m == null) return;
        m.queries.incrementAndGet();
        m.queryNanos.addAndGet(nanos);
        m.queryDocs.addAndGet(docs);
    }

    public static void recordPhase(String phase, long durationMs) {
        CashflowReadMetrics m = CURRENT.get();
        if (m == null) return;
        m.phases.merge(phase, durationMs, Long::sum);
    }

    public static final class Scope implements AutoCloseable {
        private final CashflowReadMetrics metrics;
        private final CashflowReadMetrics previous;
        private String outcome = "ok";

        private Scope(CashflowReadMetrics metrics, CashflowReadMetrics previous) {
            this.metrics = metrics;
            this.previous = previous;
        }

        public void failed(Throwable error) {
            outcome = error == null ? "error" : error.getClass().getSimpleName();
        }

        @Override
        public void close() {
            IN_FLIGHT.decrementAndGet();
            if (previous == null) CURRENT.remove(); else CURRENT.set(previous);
            metrics.log(outcome);
        }
    }

    private void log(String outcome) {
        Runtime runtime = Runtime.getRuntime();
        long totalMs = (System.nanoTime() - startedAtNanos) / 1_000_000L;
        double processCpu = -1;
        try {
            java.lang.management.OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
            if (os instanceof com.sun.management.OperatingSystemMXBean sun) processCpu = sun.getProcessCpuLoad();
        } catch (Throwable ignored) {
            // 측정은 요청을 절대 깨뜨리지 않는다.
        }
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("message", "cashflow.read.summary");
        line.put("operation", operation);
        line.put("requestId", requestId);
        line.put("projectId", projectId);
        line.put("outcome", outcome);
        line.put("totalMs", totalMs);
        line.put("reads", Map.of(
            "docGet", docGets.get(), "docGetMs", docGetNanos.get() / 1_000_000L,
            "getAll", getAlls.get(), "getAllMs", getAllNanos.get() / 1_000_000L, "getAllDocs", getAllDocs.get(),
            "query", queries.get(), "queryMs", queryNanos.get() / 1_000_000L, "queryDocs", queryDocs.get()
        ));
        line.put("phasesMs", new java.util.TreeMap<>(phases));
        Map<String, Object> instance = new LinkedHashMap<>();
        instance.put("service", System.getenv().getOrDefault("K_SERVICE", ""));
        instance.put("revision", System.getenv().getOrDefault("K_REVISION", ""));
        instance.put("instanceId", resolveInstanceId());
        instance.put("cpus", runtime.availableProcessors());
        instance.put("commonPoolParallelism", ForkJoinPool.getCommonPoolParallelism());
        instance.put("heapUsedMb", (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024));
        instance.put("heapMaxMb", runtime.maxMemory() / (1024 * 1024));
        instance.put("threads", Thread.activeCount());
        instance.put("inFlightAtStart", inFlightAtStart);
        instance.put("uptimeMs", System.currentTimeMillis() - STARTED_AT_MS);
        instance.put("processCpuLoad", processCpu);
        line.put("instance", instance);
        LOGGER.log(System.Logger.Level.INFO, line.toString());
    }

    // Cloud Run 인스턴스 id: 메타데이터 서버에서 한 번만, 최대 300ms. 로컬·테스트에선 빈 값.
    private static String resolveInstanceId() {
        if (instanceIdResolved) return instanceId;
        instanceIdResolved = true;
        if (System.getenv("K_SERVICE") == null) return "";
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(300)).build();
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://metadata.google.internal/computeMetadata/v1/instance/id"))
                .header("Metadata-Flavor", "Google")
                .timeout(Duration.ofMillis(300))
                .GET()
                .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) instanceId = response.body().trim();
        } catch (Throwable ignored) {
            instanceId = "";
        }
        return instanceId;
    }
}
