package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowVarianceRequest;
import dev.merryai.innerplatform.weekly.api.CloseCashflowMonthRequest;
import dev.merryai.innerplatform.weekly.api.DecideCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.RequestCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
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

    record CashflowSheetMonthReplacement(
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        List<CashflowMonthWeekSnapshot> weeks,
        String resultingTargetRevision
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

    record CashflowMonthCloseRecord(
        String projectId,
        String yearMonth,
        String status,
        long revision,
        long reopenCount,
        long projectWarningCount,
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
