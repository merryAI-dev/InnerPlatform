package dev.merryai.innerplatform.weekly.service.query;

import dev.merryai.innerplatform.weekly.observability.CashflowReadMetrics;
import dev.merryai.innerplatform.weekly.domain.CashflowCumulativeCloseHead;
import dev.merryai.innerplatform.weekly.domain.CashflowLedgerSource;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthCloseState;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthReopenPolicy;
import dev.merryai.innerplatform.weekly.domain.CashflowOpeningBalance;
import dev.merryai.innerplatform.weekly.domain.CashflowProjectionActualSummaryCalculator;
import dev.merryai.innerplatform.weekly.service.CashflowReadService;
import dev.merryai.innerplatform.weekly.service.port.CashflowReadPort;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.function.Supplier;

@Service
public class CashflowMonthDashboardQueryService {
    private static final System.Logger LOGGER = System.getLogger(
        CashflowMonthDashboardQueryService.class.getName()
    );

    private final CashflowReadService readService;
    private final CashflowDashboardSectionQueryService sectionQueryService;
    private final Clock clock;

    @Autowired
    public CashflowMonthDashboardQueryService(
        CashflowReadService readService,
        CashflowDashboardSectionQueryService sectionQueryService
    ) {
        this(readService, sectionQueryService, Clock.systemUTC());
    }

    CashflowMonthDashboardQueryService(
        CashflowReadService readService,
        CashflowDashboardSectionQueryService sectionQueryService,
        Clock clock
    ) {
        this.readService = readService;
        this.sectionQueryService = sectionQueryService;
        this.clock = clock;
    }

    public Result read(String tenantId, String projectId, String yearMonth, String requestId) {
        return read(tenantId, projectId, yearMonth, yearMonth, requestId);
    }

    public Result readSettlementCycle(String tenantId, String projectId, String cycleYearMonth, String requestId) {
        String monthCloseTargetYearMonth = YearMonth.parse(cycleYearMonth).minusMonths(1).toString();
        return read(tenantId, projectId, cycleYearMonth, monthCloseTargetYearMonth, requestId);
    }

    private Result read(
        String tenantId,
        String projectId,
        String yearMonth,
        String monthCloseTargetYearMonth,
        String requestId
    ) {
        YearMonth.parse(yearMonth);
        // Stage-C measurement: one summary line per request (Firestore reads, phases, instance). No logic change.
        try (CashflowReadMetrics.Scope scope = CashflowReadMetrics.begin("cashflow.dashboard_source", requestId, projectId)) {
            try {
                for (int attempt = 1; attempt <= 2; attempt += 1) {
                    CashflowReadMetrics.recordPhase("attempts", 1);
                    Result result = readAttempt(
                        tenantId, projectId, yearMonth, monthCloseTargetYearMonth, requestId, attempt
                    );
                    if (result != null) return result;
                }
                throw new UnstableRead();
            } catch (RuntimeException error) {
                scope.failed(error);
                throw error;
            }
        }
    }

    private Result readAttempt(
        String tenantId,
        String projectId,
        String cycleYearMonth,
        String monthCloseTargetYearMonth,
        String requestId,
        int attempt
    ) {
        long startedAt = System.nanoTime();
        CompletableFuture<Authority> authorityFuture = readAsync(
            requestId, projectId, attempt, "cumulative_close_head",
            () -> readAuthority(tenantId, projectId)
        );
        CashflowMonthCloseState latestRun = measuredRead(
            requestId, projectId, attempt, "month_close",
            () -> readService.monthClose(tenantId, projectId, cycleYearMonth)
        );
        Authority authority = join(authorityFuture);
        boolean pristineOpen = "MISSING".equals(authority.availability()) && latestRun.isPristineOpen();
        String operationalStatus = authority.isAvailable()
            ? authority.head().operationalStatus(cycleYearMonth)
            : pristineOpen ? "OPEN" : null;
        String monthStatusIssueCode = operationalStatus == null
            ? "CUMULATIVE_CLOSE_AUTHORITY_" + authority.availability()
            : !operationalStatus.equals(latestRun.status())
                ? "MONTH_CLOSE_HISTORY_STATUS_DIFFERS_FROM_CUMULATIVE_AUTHORITY"
                : null;
        ActionCapability reopenRequest = reopenRequestCapability(
            authority, latestRun, cycleYearMonth
        );
        boolean open = "OPEN".equals(operationalStatus);
        boolean amendedClosed = "CLOSED".equals(operationalStatus) && isAmendedClosed(latestRun);
        boolean currentLedgerView = open || amendedClosed;
        SnapshotCompatibility snapshotCompatibility = operationalStatus == null
            ? new SnapshotCompatibility("AUTHORITY_UNAVAILABLE", List.of())
            : amendedClosed
                ? new SnapshotCompatibility("LIVE_AMENDED", List.of())
                : open
                    ? new SnapshotCompatibility("LIVE_CURRENT", List.of())
                    : frozenSnapshotCompatibility(latestRun);

        CompletableFuture<CashflowDashboardSectionResult<Integer>> weeklyYearFuture = open
            ? sectionReadAsync(
                requestId, projectId, attempt, "declared_weekly_year",
                "cashflow_declared_weekly_year_unavailable",
                () -> readService.declaredWeeklyYear(tenantId, projectId)
            )
            : CompletableFuture.completedFuture(CashflowDashboardSectionResult.available(null));
        CompletableFuture<CashflowDashboardSectionResult<OpeningBalances>> openingBalancesFuture =
            currentLedgerView
                ? sectionReadAsync(
                    requestId, projectId, attempt, "opening_balance",
                    "cashflow_opening_balances_unavailable",
                    () -> OpeningBalances.live(readService.openingBalance(
                        tenantId, projectId, Integer.parseInt(monthCloseTargetYearMonth.substring(0, 4))
                    ))
                )
                : CompletableFuture.completedFuture(CashflowDashboardSectionResult.available(
                    authority.isAvailable()
                        && !snapshotCompatibility.missingEvidence().contains("OPENING_BALANCES")
                            ? OpeningBalances.frozen(latestRun.snapshot().get("openingBalances"))
                            : null
                ));
        CompletableFuture<CashflowDashboardSectionResult<CashflowLedgerSource>> sourceFuture;
        if (amendedClosed) {
            sourceFuture = sectionReadAsync(
                requestId, projectId, attempt, "global_ledger",
                "cashflow_ledger_source_unavailable",
                () -> requireLedgerSource(readService.globalLedgerSource(tenantId, projectId))
            );
        } else if (open) {
            sourceFuture = weeklyYearFuture.thenCompose(weeklyYearResult -> {
                if (!weeklyYearResult.isAvailable()) {
                    return CompletableFuture.completedFuture(CashflowDashboardSectionResult.unavailable(
                        weeklyYearResult.errorCode()
                    ));
                }
                Integer weeklyYear = weeklyYearResult.value();
                return weeklyYear == null
                    ? CompletableFuture.completedFuture(CashflowDashboardSectionResult.unavailable(
                        "cashflow_declared_weekly_year_missing"
                    ))
                    : sectionReadAsync(
                        requestId, projectId, attempt, "weekly_ledger",
                        "cashflow_ledger_source_unavailable",
                        () -> requireLedgerSource(
                            readService.ledgerSource(tenantId, projectId, weeklyYear)
                        )
                    );
            });
        } else {
            sourceFuture = CompletableFuture.completedFuture(CashflowDashboardSectionResult.available(null));
        }

        List<Blocker> blockers = new ArrayList<>();
        List<SectionError> sectionErrors = new ArrayList<>();
        addAuthorityBlocker(authority, pristineOpen, blockers);
        CashflowDashboardSectionResult<Integer> weeklyYearResult = join(weeklyYearFuture);
        if (open && weeklyYearResult.isAvailable() && weeklyYearResult.value() == null) {
            blockers.add(new Blocker("SHEET_SOURCE_REQUIRED"));
        }
        CashflowDashboardSectionResult<CashflowLedgerSource> sourceResult = join(sourceFuture);
        if (currentLedgerView && !sourceResult.isAvailable()) {
            addUnavailable(
                sectionErrors, blockers, "cashflow", sourceResult.errorCode(),
                "CASHFLOW_SOURCE_UNAVAILABLE"
            );
        }
        CashflowLedgerSource source = currentLedgerView ? sourceResult.value() : null;
        CashflowDashboardSectionResult<OpeningBalances> openingBalancesResult = join(openingBalancesFuture);
        if (!openingBalancesResult.isAvailable()) {
            addUnavailable(
                sectionErrors, blockers, "openingBalances", openingBalancesResult.errorCode(),
                "OPENING_BALANCES_UNAVAILABLE"
            );
        }

        if (amendedClosed) {
            CashflowMonthCloseState verified = measuredRead(
                requestId, projectId, attempt, "month_close_verify",
                () -> readService.monthClose(tenantId, projectId, cycleYearMonth)
            );
            String expectedTargetRevision = String.valueOf(
                verified.lastAmendmentEvidence().getOrDefault("resultingTargetRevision", "")
            );
            boolean stableEvidence = "CLOSED".equals(verified.status())
                && verified.amendmentCount() > 0
                && latestRun.snapshotHash().equals(verified.snapshotHash())
                && latestRun.lastAmendmentEvidence().equals(verified.lastAmendmentEvidence());
            if (!stableEvidence || (source != null && (
                expectedTargetRevision.isBlank()
                    || !expectedTargetRevision.equals(source.targetRevision())
            ))) {
                return null;
            }
            latestRun = verified;
        }

        CashflowDashboardSectionResult<CashflowProjectionActualSummaryCalculator.Summary> summaryResult =
            sectionQueryService.read(
                "cashflow_projection_actual_summary_unavailable",
                () -> {
                    CashflowLedgerSource summarySource = summarySource(
                        tenantId, projectId, monthCloseTargetYearMonth
                    );
                    return CashflowProjectionActualSummaryCalculator.calculate(
                        projectId,
                        summarySource.projection(),
                        summarySource.actual(),
                        CashflowProjectionActualSummaryCalculator.currentFinanceWeek(clock),
                        monthCloseTargetYearMonth
                    );
                }
            );
        if (!summaryResult.isAvailable()) {
            addUnavailable(
                sectionErrors, blockers, "projectionActualSummary", summaryResult.errorCode(),
                "PROJECTION_ACTUAL_SUMMARY_UNAVAILABLE"
            );
        }
        log(requestId, projectId, attempt, "complete", (System.nanoTime() - startedAt) / 1_000_000L);
        return new Result(
            latestRun,
            operationalStatus,
            monthStatusIssueCode,
            reopenRequest,
            authority,
            source,
            openingBalancesResult.value(),
            snapshotCompatibility,
            summaryResult.value(),
            blockers,
            sectionErrors
        );
    }

    private CashflowLedgerSource summarySource(
        String tenantId,
        String projectId,
        String yearMonth
    ) {
        Integer weeklyYear = readService.declaredWeeklyYear(tenantId, projectId);
        if (weeklyYear == null) {
            throw new CashflowReadPort.Unavailable(
                new IllegalStateException("Declared weekly year is unavailable.")
            );
        }
        String boundaryMonth = CashflowProjectionActualSummaryCalculator.currentFinanceWeek(clock).yearMonth();
        String throughMonth = yearMonth.compareTo(boundaryMonth) > 0 ? yearMonth : boundaryMonth;
        return requireLedgerSource(readService.ledgerSource(
            tenantId,
            projectId,
            weeklyYear,
            CashflowProjectionActualSummaryCalculator.FROM_MONTH,
            throughMonth
        ));
    }

    private CashflowLedgerSource requireLedgerSource(CashflowLedgerSource source) {
        if (source == null) {
            throw new CashflowReadPort.Unavailable(
                new IllegalStateException("Weekly source is unavailable.")
            );
        }
        return source;
    }

    private Authority readAuthority(String tenantId, String projectId) {
        try {
            CashflowCumulativeCloseHead head = readService.cumulativeCloseHead(tenantId, projectId);
            return head == null ? Authority.unavailable("MISSING") : Authority.available(head);
        } catch (CashflowReadPort.InvalidCumulativeCloseAuthority error) {
            return Authority.unavailable("INVALID");
        } catch (CashflowReadPort.Unavailable error) {
            return Authority.unavailable("UNAVAILABLE");
        }
    }

    private boolean isAmendedClosed(CashflowMonthCloseState latestRun) {
        String amendmentSnapshotHash = String.valueOf(
            latestRun.lastAmendmentEvidence().getOrDefault("closeSnapshotHash", "")
        );
        return "CLOSED".equals(latestRun.status())
            && latestRun.amendmentCount() > 0
            && !amendmentSnapshotHash.isBlank()
            && amendmentSnapshotHash.equals(latestRun.snapshotHash());
    }

    private ActionCapability reopenRequestCapability(
        Authority authority,
        CashflowMonthCloseState latestRun,
        String yearMonth
    ) {
        if (!authority.isAvailable()) {
            return ActionCapability.deny("CUMULATIVE_CLOSE_AUTHORITY_" + authority.availability());
        }
        CashflowCumulativeCloseHead head = authority.head();
        try {
            CashflowMonthReopenPolicy.request(
                new CashflowMonthReopenPolicy.Facts(
                    true,
                    head.settlementMonth(),
                    head.closedThrough(),
                    head.headRevision(),
                    !latestRun.isPristineOpen(),
                    CashflowMonthReopenPolicy.State.fromStorage(latestRun.status()),
                    latestRun.revision(),
                    latestRun.reopenCount(),
                    latestRun.projectWarningCount(),
                    latestRun.reopenRequestedByUid()
                ),
                yearMonth,
                latestRun.revision()
            );
            return ActionCapability.allow();
        } catch (CashflowMonthReopenPolicy.Violation error) {
            return ActionCapability.deny("CASHFLOW_MONTH_REOPEN_" + error.reason().name());
        }
    }

    private SnapshotCompatibility frozenSnapshotCompatibility(CashflowMonthCloseState latestRun) {
        List<String> missingEvidence = new ArrayList<>();
        Map<String, Object> snapshot = latestRun.snapshot();
        if (!snapshot.containsKey("openingBalances")) missingEvidence.add("OPENING_BALANCES");
        if (!snapshot.containsKey("ledgerWeeks")) missingEvidence.add("LEDGER_WEEKS");
        return new SnapshotCompatibility(
            missingEvidence.isEmpty() ? "FROZEN_COMPLETE" : "LEGACY_EVIDENCE_ONLY",
            missingEvidence
        );
    }

    private void addAuthorityBlocker(
        Authority authority,
        boolean pristineOpen,
        List<Blocker> blockers
    ) {
        if (authority.isAvailable() || pristineOpen) return;
        blockers.add(new Blocker("CUMULATIVE_CLOSE_AUTHORITY_" + authority.availability()));
    }

    private void addUnavailable(
        List<SectionError> sectionErrors,
        List<Blocker> blockers,
        String section,
        String errorCode,
        String blockerCode
    ) {
        sectionErrors.add(new SectionError(section, errorCode));
        blockers.add(new Blocker(blockerCode));
    }

    private <T> CompletableFuture<T> readAsync(
        String requestId,
        String projectId,
        int attempt,
        String phase,
        Supplier<T> operation
    ) {
        return CompletableFuture.supplyAsync(
            CashflowReadMetrics.propagate(() -> measuredRead(requestId, projectId, attempt, phase, operation))
        );
    }

    private <T> T join(CompletableFuture<T> future) {
        try {
            return future.join();
        } catch (CompletionException error) {
            Throwable cause = error.getCause() == null ? error : error.getCause();
            if (cause instanceof RuntimeException runtime) throw runtime;
            throw error;
        }
    }

    private <T> CompletableFuture<CashflowDashboardSectionResult<T>> sectionReadAsync(
        String requestId,
        String projectId,
        int attempt,
        String phase,
        String unavailableCode,
        Supplier<T> operation
    ) {
        return readAsync(
            requestId,
            projectId,
            attempt,
            phase,
            () -> sectionQueryService.read(unavailableCode, operation)
        );
    }

    private <T> T measuredRead(
        String requestId,
        String projectId,
        int attempt,
        String phase,
        Supplier<T> operation
    ) {
        long startedAt = System.nanoTime();
        try {
            return operation.get();
        } finally {
            log(requestId, projectId, attempt, phase, (System.nanoTime() - startedAt) / 1_000_000L);
        }
    }

    private void log(String requestId, String projectId, int attempt, String phase, long durationMs) {
        CashflowReadMetrics.recordPhase(phase, durationMs);
        LOGGER.log(
            System.Logger.Level.INFO,
            "cashflow_dashboard_source requestId={0} projectId={1} attempt={2} phase={3} durationMs={4}",
            requestId, projectId, attempt, phase, durationMs
        );
    }

    public record Result(
        CashflowMonthCloseState latestRun,
        String operationalStatus,
        String monthStatusIssueCode,
        ActionCapability reopenRequest,
        Authority authority,
        CashflowLedgerSource source,
        OpeningBalances openingBalances,
        SnapshotCompatibility snapshotCompatibility,
        CashflowProjectionActualSummaryCalculator.Summary projectionActualSummary,
        List<Blocker> blockers,
        List<SectionError> sectionErrors
    ) {
        public Result {
            blockers = blockers == null ? List.of() : List.copyOf(blockers);
            sectionErrors = sectionErrors == null ? List.of() : List.copyOf(sectionErrors);
        }
    }

    public record Authority(String availability, CashflowCumulativeCloseHead head) {
        static Authority available(CashflowCumulativeCloseHead head) {
            return new Authority("AVAILABLE", head);
        }

        static Authority unavailable(String availability) {
            return new Authority(availability, null);
        }

        public boolean isAvailable() {
            return "AVAILABLE".equals(availability) && head != null;
        }
    }

    public record OpeningBalances(CashflowOpeningBalance live, Object frozen) {
        static OpeningBalances live(CashflowOpeningBalance value) {
            return new OpeningBalances(value, null);
        }

        static OpeningBalances frozen(Object value) {
            return value == null ? null : new OpeningBalances(null, value);
        }
    }

    public record SnapshotCompatibility(String status, List<String> missingEvidence) {
        public SnapshotCompatibility {
            missingEvidence = missingEvidence == null ? List.of() : List.copyOf(missingEvidence);
        }
    }

    public record Blocker(String code) {}

    public record SectionError(String section, String code) {}

    public record ActionCapability(boolean enabled, String reasonCode) {
        static ActionCapability allow() {
            return new ActionCapability(true, "");
        }

        static ActionCapability deny(String reasonCode) {
            return new ActionCapability(false, reasonCode);
        }
    }

    public static final class UnstableRead extends RuntimeException {
        public UnstableRead() {
            super("Canonical cashflow ledger changed while it was being read.");
        }
    }
}
