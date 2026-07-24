package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowVarianceRequest;
import dev.merryai.innerplatform.weekly.api.CloseCashflowMonthRequest;
import dev.merryai.innerplatform.weekly.api.CompleteCashflowWeeklyUpdateRequest;
import dev.merryai.innerplatform.weekly.api.DecideCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.RequestCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.ReopenCashflowWeeklyUpdateRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetBatchApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetAnnualApplyRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseActualEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditEventEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditExportEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportBatchEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportLineEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseProjectionEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSheetEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseWeeklyStatusEntity;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Callable;

public interface WeeklyExpensePersistence {
    record CashflowMonthWeekSnapshot(
        int weekNo,
        Map<String, Object> projection,
        Map<String, Object> actual
    ) {
        public CashflowMonthWeekSnapshot {
            projection = projection == null ? Map.of() : Map.copyOf(projection);
            actual = actual == null ? Map.of() : Map.copyOf(actual);
        }
    }

    record CashflowLedgerWeekSnapshot(
        String yearMonth,
        int weekNo,
        Map<String, Object> projection,
        Map<String, Object> actual
    ) {
        public CashflowLedgerWeekSnapshot {
            projection = projection == null ? Map.of() : Map.copyOf(projection);
            actual = actual == null ? Map.of() : Map.copyOf(actual);
        }
    }

    record CashflowSheetMonthReplacement(
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        List<CashflowMonthWeekSnapshot> weeks,
        List<CashflowLedgerWeekSnapshot> ledgerWeeks,
        String resultingTargetRevision,
        List<CashflowSettledWeekChange> settledWeekChanges
    ) {
        public CashflowSheetMonthReplacement(
            List<WeeklyExpenseProjectionEntity> projection,
            List<WeeklyExpenseActualEntity> actual,
            List<CashflowMonthWeekSnapshot> weeks,
            List<CashflowLedgerWeekSnapshot> ledgerWeeks,
            String resultingTargetRevision
        ) {
            this(projection, actual, weeks, ledgerWeeks, resultingTargetRevision, List.of());
        }

        public CashflowSheetMonthReplacement(
            List<WeeklyExpenseProjectionEntity> projection,
            List<WeeklyExpenseActualEntity> actual,
            List<CashflowMonthWeekSnapshot> weeks,
            String resultingTargetRevision
        ) {
            this(projection, actual, weeks, List.of(), resultingTargetRevision, List.of());
        }
    }

    record CashflowSheetBatchMonthReplacement(
        String yearMonth,
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        List<CashflowMonthWeekSnapshot> weeks
    ) {
    }

    record CashflowSheetBatchReplacement(
        List<CashflowSheetBatchMonthReplacement> months,
        List<CashflowLedgerWeekSnapshot> ledgerWeeks,
        String resultingTargetRevision,
        List<CashflowSettledWeekChange> settledWeekChanges
    ) {
    }

    record CashflowSettledWeekChange(
        String yearMonth,
        int weekNo,
        long completionRevision,
        long warningCount
    ) {
    }

    record CashflowClosedMonthAmendment(
        String yearMonth,
        long closeRevision,
        String closeSnapshotHash,
        String deadline,
        boolean postDeadline,
        long amendmentCount,
        long warningCount
    ) {
    }

    record CashflowSheetAnnualReplacement(
        long revision,
        Map<String, java.math.BigDecimal> projection,
        Map<String, java.math.BigDecimal> actual,
        Map<String, String> projectionStates,
        Map<String, String> actualStates
    ) {
    }

    record CashflowSheetAnnualTotal(
        int year,
        Map<String, java.math.BigDecimal> projection,
        Map<String, java.math.BigDecimal> actual,
        Map<String, String> projectionStates,
        Map<String, String> actualStates
    ) {
    }

    /**
     * One authoritative read of the weekly cashflow ledger. Projection, Actual,
     * and the years used to suppress annual fallbacks must come from the same
     * storage snapshot so carry-forward cannot observe three different versions.
     */
    record CashflowLedgerSource(
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        List<Integer> weeklyYears,
        String targetRevision
    ) {
        public CashflowLedgerSource(
            List<WeeklyExpenseProjectionEntity> projection,
            List<WeeklyExpenseActualEntity> actual,
            List<Integer> weeklyYears
        ) {
            this(projection, actual, weeklyYears, "");
        }

        public CashflowLedgerSource {
            projection = projection == null ? List.of() : List.copyOf(projection);
            actual = actual == null ? List.of() : List.copyOf(actual);
            weeklyYears = weeklyYears == null ? List.of() : weeklyYears.stream().distinct().sorted().toList();
            targetRevision = targetRevision == null ? "" : targetRevision;
        }
    }

    record CashflowOpeningBalance(
        int selectedYear,
        Mode projection,
        Mode actual
    ) {
        public record Mode(
            BigDecimal amount,
            Map<String, BigDecimal> lineAmounts,
            List<YearSource> sources,
            List<Integer> includedYears,
            List<Integer> excludedWeeklyYears
        ) {
            public Mode {
                amount = amount == null ? BigDecimal.ZERO : amount;
                lineAmounts = lineAmounts == null ? Map.of() : Map.copyOf(lineAmounts);
                sources = sources == null ? List.of() : List.copyOf(sources);
                includedYears = includedYears == null ? List.of() : List.copyOf(includedYears);
                excludedWeeklyYears = excludedWeeklyYears == null ? List.of() : List.copyOf(excludedWeeklyYears);
            }
        }

        public record YearSource(
            int year,
            Map<String, BigDecimal> lineAmounts,
            Map<String, String> lineStates
        ) {
            public YearSource {
                lineAmounts = lineAmounts == null ? Map.of() : Map.copyOf(lineAmounts);
                lineStates = lineStates == null ? Map.of() : Map.copyOf(lineStates);
            }
        }
    }

    record CashflowMonthCloseRecord(
        String projectId,
        String yearMonth,
        String status,
        long revision,
        long reopenCount,
        long projectWarningCount,
        long amendmentCount,
        long postDeadlineAmendmentWarningCount,
        String lastAmendmentAt,
        String lastAmendmentByUid,
        String lastAmendmentByName,
        String lastAmendmentReason,
        String lastAmendmentDeadline,
        boolean lastAmendmentPostDeadline,
        Map<String, Object> lastAmendmentEvidence,
        String snapshotHash,
        String previousSnapshotHash,
        Map<String, Object> snapshot,
        Map<String, Object> previousSnapshot,
        boolean closeEligible,
        String evaluatedBusinessDate,
        String closeDeadline,
        boolean late,
        String closedAt,
        String closedByUid,
        String closedByName,
        String reopenReason,
        String reopenRequestedAt,
        String reopenRequestedByUid,
        String reopenDecision,
        String reopenDecisionReason,
        String reopenDecidedAt,
        String reopenDecidedByUid
    ) {
        public CashflowMonthCloseRecord {
            snapshot = snapshot == null ? Map.of() : Map.copyOf(snapshot);
            previousSnapshot = previousSnapshot == null ? Map.of() : Map.copyOf(previousSnapshot);
        }
    }

    record CashflowVarianceRecord(
        String sheetId,
        String projectId,
        String tenantId,
        String yearMonth,
        Map<String, Object> varianceFlag,
        List<Map<String, Object>> varianceHistory,
        long varianceRevision,
        String updatedAt,
        String updatedByUid,
        String updatedByName
    ) {
        public CashflowVarianceRecord {
            varianceFlag = varianceFlag == null ? Map.of() : Map.copyOf(varianceFlag);
            varianceHistory = varianceHistory == null
                ? List.of()
                : varianceHistory.stream().map(Map::copyOf).toList();
        }
    }

    record CashflowWeeklyUpdateCompletionRecord(
        String projectId,
        String yearMonth,
        int weekNo,
        String completedAt,
        String completedBy,
        boolean alreadyCompleted,
        String status,
        long revision,
        long reopenCount,
        String snapshotHash,
        String sourceRevision,
        String targetRevision,
        String reopenedAt,
        String reopenedBy,
        String reopenReason
    ) {
    }

    record CashflowWeekScope(String yearMonth, int weekNo) {
    }

    default <T> T runCommandTransaction(Callable<T> action) {
        try {
            return action.call();
        } catch (RuntimeException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("Weekly expense command transaction failed.", error);
        }
    }

    default void requireCashflowDataProject(String dataProjectId) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_data_project_backend_unavailable",
            "Cashflow data-project validation requires the Firestore transaction backend."
        );
    }

    default String requireCashflowWriteLease(
        TrustedActorContext actor,
        String projectId,
        CashflowEditSession session
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_edit_lease_backend_unavailable",
            "Cashflow edit leases require the Firestore transaction backend."
        );
    }

    default String requireCashflowWritePermission(TrustedActorContext actor, String projectId) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_write_permission_backend_unavailable",
            "Cashflow write permission checks require the Firestore transaction backend."
        );
    }

    default String requireCashflowMonthClosePermission(TrustedActorContext actor, String projectId) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_close_permission_backend_unavailable",
            "Cashflow month-close permission checks require the Firestore transaction backend."
        );
    }

    default void requireCashflowMonthsOpen(
        String tenantId,
        String projectId,
        Collection<String> yearMonths
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_guard_backend_unavailable",
            "Cashflow month locking requires the Firestore transaction backend."
        );
    }

    default void requireCashflowWeeksOpen(
        String tenantId,
        String projectId,
        Collection<CashflowWeekScope> weeks
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_week_guard_backend_unavailable",
            "Cashflow week validation requires the Firestore transaction backend."
        );
    }

    default CashflowMonthCloseRecord findCashflowMonthClose(
        String tenantId,
        String projectId,
        String yearMonth
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_close_backend_unavailable",
            "Cashflow month close reads require the Firestore transaction backend."
        );
    }

    default CashflowVarianceRecord updateCashflowVariance(
        TrustedActorContext actor,
        String projectId,
        CashflowVarianceRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_variance_backend_unavailable",
            "Cashflow variance updates require the Firestore transaction backend."
        );
    }

    default CashflowMonthCloseRecord closeCashflowMonth(
        TrustedActorContext actor,
        String projectId,
        String sourceSheetKey,
        CloseCashflowMonthRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_close_backend_unavailable",
            "Cashflow month close requires the Firestore transaction backend."
        );
    }

    default CashflowWeeklyUpdateCompletionRecord completeCashflowWeeklyUpdate(
        TrustedActorContext actor,
        String projectId,
        CompleteCashflowWeeklyUpdateRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_weekly_completion_backend_unavailable",
            "Cashflow weekly completion requires the Firestore transaction backend."
        );
    }

    default CashflowWeeklyUpdateCompletionRecord findCashflowWeeklyUpdateCompletion(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_weekly_update_backend_unavailable",
            "Cashflow weekly update reads require the Firestore transaction backend."
        );
    }

    default CashflowWeeklyUpdateCompletionRecord reopenCashflowWeeklyUpdate(
        TrustedActorContext actor,
        String projectId,
        ReopenCashflowWeeklyUpdateRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_weekly_reopen_backend_unavailable",
            "Cashflow weekly reopen requires the Firestore transaction backend."
        );
    }

    default CashflowMonthCloseRecord requestCashflowMonthReopen(
        TrustedActorContext actor,
        String projectId,
        RequestCashflowMonthReopenRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_reopen_backend_unavailable",
            "Cashflow month reopen requires the Firestore transaction backend."
        );
    }

    default CashflowMonthCloseRecord decideCashflowMonthReopen(
        TrustedActorContext actor,
        String projectId,
        DecideCashflowMonthReopenRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_reopen_backend_unavailable",
            "Cashflow month reopen decisions require the Firestore transaction backend."
        );
    }

    default CashflowSheetMonthReplacement replaceCashflowSheetMonth(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String yearMonth,
        String targetRevision,
        List<CashflowSheetLabApplyRequest.Cell> cells
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_replace_backend_unavailable",
            "Authoritative monthly cashflow replacement requires the Firestore transaction backend."
        );
    }

    default CashflowSheetBatchReplacement replaceCashflowSheetMonths(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String targetRevision,
        CashflowSheetBatchApplyRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_batch_replace_backend_unavailable",
            "Authoritative multi-month cashflow replacement requires the Firestore transaction backend."
        );
    }

    default CashflowSheetMonthReplacement replaceCashflowSheetMonth(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String yearMonth,
        String targetRevision,
        List<CashflowSheetLabApplyRequest.Cell> cells,
        boolean replaceAllActualSources,
        dev.merryai.innerplatform.weekly.api.CashflowSettledWeekChangeConfirmation settledWeekChangeConfirmation,
        String sourceRevision,
        String idempotencyKey
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_replace_backend_unavailable",
            "Authoritative monthly cashflow replacement requires the Firestore transaction backend."
        );
    }

    default List<CashflowClosedMonthAmendment> authorizeCashflowSheetMonthAmendments(
        TrustedActorContext actor,
        String projectId,
        Collection<String> yearMonths,
        String sourceRevision,
        String reason,
        String idempotencyKey
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_amendment_backend_unavailable",
            "Cashflow closed-month amendments require the Firestore transaction backend."
        );
    }

    default void recordCashflowSheetMonthAmendments(
        TrustedActorContext actor,
        String projectId,
        List<CashflowClosedMonthAmendment> amendments,
        String sourceRevision,
        String targetRevision,
        String resultingTargetRevision,
        Map<String, List<Map<String, Object>>> calculationChecksByMonth,
        String reason,
        String idempotencyKey
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_month_amendment_backend_unavailable",
            "Cashflow closed-month amendment records require the Firestore transaction backend."
        );
    }

    default CashflowSheetMonthReplacement replaceCashflowSheetMonth(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String yearMonth,
        String targetRevision,
        List<CashflowSheetLabApplyRequest.Cell> cells,
        boolean replaceAllActualSources
    ) {
        return replaceCashflowSheetMonth(tenantId, projectId, sourceSheetKey, yearMonth, targetRevision, cells);
    }

    default int countCashflowActualReplacementWrites(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        List<String> requestedWeekDocumentIds
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_atomic_plan_backend_unavailable",
            "Cashflow atomic write planning requires the Firestore transaction backend."
        );
    }

    default CashflowSheetAnnualReplacement replaceCashflowSheetYearTotal(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        CashflowSheetAnnualApplyRequest request
    ) {
        throw new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_annual_replace_backend_unavailable",
            "Authoritative annual cashflow replacement requires the Firestore transaction backend."
        );
    }

    default List<CashflowSheetAnnualTotal> findCashflowSheetYearTotals(String tenantId, String projectId) {
        return List.of();
    }

    default List<Integer> findCashflowWeeklyYears(String tenantId, String projectId) {
        return findCashflowLedgerSource(tenantId, projectId).weeklyYears();
    }

    default CashflowLedgerSource findCashflowLedgerSource(String tenantId, String projectId) {
        List<WeeklyExpenseProjectionEntity> projection = findProjectionLines(tenantId, projectId);
        List<WeeklyExpenseActualEntity> actual = findActualLines(tenantId, projectId);
        List<Integer> weeklyYears = java.util.stream.Stream.concat(
                projection.stream().map(WeeklyExpenseProjectionEntity::getYearMonth),
                actual.stream().map(WeeklyExpenseActualEntity::getYearMonth)
            )
            .filter(value -> value != null && value.matches("20\\d{2}-(0[1-9]|1[0-2])"))
            .map(value -> Integer.parseInt(value.substring(0, 4)))
            .distinct()
            .sorted()
            .toList();
        return new CashflowLedgerSource(projection, actual, weeklyYears);
    }

    /**
     * Canonical carry-forward policy for cashflow reads and month-close snapshots.
     * A prior year uses weekly ledger lines when that year exists in the weekly ledger;
     * the annual-total document is only a fallback, so a year can never be counted twice.
     */
    default CashflowOpeningBalance findCashflowOpeningBalance(
        String tenantId,
        String projectId,
        int selectedYear
    ) {
        return findCashflowOpeningBalance(
            tenantId,
            projectId,
            selectedYear,
            findCashflowWeeklyYears(tenantId, projectId)
        );
    }

    default CashflowOpeningBalance findCashflowOpeningBalance(
        String tenantId,
        String projectId,
        int selectedYear,
        Collection<Integer> sourceWeeklyYears
    ) {
        if (selectedYear < 2000 || selectedYear > 2099) {
            throw new IllegalArgumentException("Cashflow opening-balance year must be between 2000 and 2099.");
        }
        List<Integer> weeklyYears = (sourceWeeklyYears == null ? List.<Integer>of() : sourceWeeklyYears).stream()
            .filter(year -> year < selectedYear)
            .distinct()
            .sorted()
            .toList();
        List<CashflowSheetAnnualTotal> annualTotals = findCashflowSheetYearTotals(tenantId, projectId).stream()
            .filter(total -> total.year() < selectedYear && !weeklyYears.contains(total.year()))
            .sorted(java.util.Comparator.comparingInt(CashflowSheetAnnualTotal::year))
            .toList();
        List<Integer> includedYears = annualTotals.stream().map(CashflowSheetAnnualTotal::year).toList();
        List<CashflowOpeningBalance.YearSource> projectionSources = annualTotals.stream()
            .map(total -> new CashflowOpeningBalance.YearSource(
                total.year(),
                total.projection(),
                total.projectionStates()
            ))
            .toList();
        List<CashflowOpeningBalance.YearSource> actualSources = annualTotals.stream()
            .map(total -> new CashflowOpeningBalance.YearSource(
                total.year(),
                total.actual(),
                total.actualStates()
            ))
            .toList();
        Map<String, BigDecimal> projectionLines = cashflowAggregateLines(projectionSources);
        Map<String, BigDecimal> actualLines = cashflowAggregateLines(actualSources);

        return new CashflowOpeningBalance(
            selectedYear,
            new CashflowOpeningBalance.Mode(
                cashflowMapNet(projectionLines),
                projectionLines,
                projectionSources,
                includedYears,
                weeklyYears
            ),
            new CashflowOpeningBalance.Mode(
                cashflowMapNet(actualLines),
                actualLines,
                actualSources,
                includedYears,
                weeklyYears
            )
        );
    }

    private static Map<String, BigDecimal> cashflowAggregateLines(
        List<CashflowOpeningBalance.YearSource> sources
    ) {
        Map<String, BigDecimal> totals = new java.util.TreeMap<>();
        for (CashflowOpeningBalance.YearSource source : sources) {
            source.lineAmounts().forEach((rawLine, value) -> {
                String line = dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog.canonicalize(rawLine);
                if (!dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog.ALL_LINES.contains(line)) return;
                totals.merge(line, value == null ? BigDecimal.ZERO : value, BigDecimal::add);
            });
        }
        return Map.copyOf(totals);
    }

    private static BigDecimal cashflowMapNet(Map<String, BigDecimal> amounts) {
        if (amounts == null) return BigDecimal.ZERO;
        BigDecimal totalIn = dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog.IN_LINES.stream()
            .map(line -> amounts.getOrDefault(line, BigDecimal.ZERO))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalOut = dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog.OUT_LINES.stream()
            .map(line -> amounts.getOrDefault(line, BigDecimal.ZERO))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        return totalIn.subtract(totalOut);
    }

    Optional<WeeklyExpenseIdempotencyEntity> findIdempotency(
        String tenantId,
        String projectId,
        String commandName,
        String idempotencyKey
    );

    WeeklyExpenseIdempotencyEntity saveIdempotency(WeeklyExpenseIdempotencyEntity idempotency);

    Optional<WeeklyExpenseSheetEntity> findSheetForUpdate(String tenantId, String projectId, String sheetKey);

    List<WeeklyExpenseSheetEntity> findSheets(String tenantId, String projectId);

    WeeklyExpenseSheetEntity saveSheet(WeeklyExpenseSheetEntity sheet);

    void flushSheet(WeeklyExpenseSheetEntity sheet);

    List<SaveDraftResponse.ActualDelta> replaceActuals(
        WeeklyExpenseSheetEntity sheet,
        List<SaveDraftResponse.ActualDelta> deltas
    );

    List<WeeklyExpenseActualEntity> replaceActualLines(
        String tenantId,
        String projectId,
        String sheetKey,
        List<SaveDraftResponse.ActualDelta> deltas
    );

    List<WeeklyExpenseActualEntity> findActualLines(String tenantId, String projectId);

    List<WeeklyExpenseActualEntity> findActualLinesForAudit(String tenantId, String projectId);

    WeeklyExpenseAuditEventEntity saveAuditEvent(WeeklyExpenseAuditEventEntity auditEvent);

    List<WeeklyExpenseAuditEventEntity> findAuditEventsForAudit(String tenantId, String projectId);

    List<WeeklyExpenseAuditEventEntity> findRecentAuditEvents(String tenantId, String projectId, int limit);

    WeeklyExpenseAuditExportEntity saveAuditExport(WeeklyExpenseAuditExportEntity auditExport);

    WeeklyExpenseBankImportBatchEntity saveBankImportBatch(WeeklyExpenseBankImportBatchEntity batch);

    Optional<WeeklyExpenseBankImportLineEntity> findBankImportLineBySourceKey(
        String tenantId,
        String projectId,
        String sourceLineKey
    );

    List<WeeklyExpenseBankImportLineEntity> findBankImportLines(String tenantId, String projectId, String status);

    List<WeeklyExpenseBankImportLineEntity> findBankImportLinesForUpdate(
        String tenantId,
        String projectId,
        Collection<String> ids
    );

    List<WeeklyExpenseBankImportLineEntity> saveBankImportLines(List<WeeklyExpenseBankImportLineEntity> lines);

    Optional<WeeklyExpenseProjectionEntity> findProjectionLine(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo,
        String cashflowLine
    );

    WeeklyExpenseProjectionEntity saveProjection(WeeklyExpenseProjectionEntity projection);

    List<WeeklyExpenseProjectionEntity> findProjectionLines(String tenantId, String projectId);

    List<WeeklyExpenseProjectionEntity> findProjectionLinesForAudit(String tenantId, String projectId);

    Optional<WeeklyExpenseWeeklyStatusEntity> findWeeklyStatus(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo
    );

    WeeklyExpenseWeeklyStatusEntity saveWeeklyStatus(WeeklyExpenseWeeklyStatusEntity status);

    List<WeeklyExpenseWeeklyStatusEntity> findWeeklyStatuses(String tenantId, String projectId);
}
