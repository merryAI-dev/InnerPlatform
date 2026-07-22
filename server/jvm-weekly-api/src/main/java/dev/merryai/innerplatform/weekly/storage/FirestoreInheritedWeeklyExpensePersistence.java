package dev.merryai.innerplatform.weekly.storage;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.Timestamp;
import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import com.google.cloud.firestore.Query;
import com.google.cloud.firestore.QuerySnapshot;
import com.google.cloud.firestore.SetOptions;
import com.google.cloud.firestore.Transaction;
import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowVarianceRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetBatchApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetAnnualApplyRequest;
import dev.merryai.innerplatform.weekly.api.CloseCashflowMonthRequest;
import dev.merryai.innerplatform.weekly.api.CompleteCashflowWeeklyUpdateRequest;
import dev.merryai.innerplatform.weekly.api.DecideCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.RequestCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.ReopenCashflowWeeklyUpdateRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException;
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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.Callable;

@Repository
@ConditionalOnProperty(name = "weekly.storage-backend", havingValue = "firestore")
public class FirestoreInheritedWeeklyExpensePersistence implements WeeklyExpensePersistence {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> CASHFLOW_WRITE_ROLES = Set.of("admin", "finance", "pm", "viewer", "tenant_admin");
    private static final Set<String> CASHFLOW_CROSS_PROJECT_ROLES = Set.of("admin", "finance", "tenant_admin");
    private static final String CASHFLOW_MONTH_CLOSE_CONTRACT_VERSION = "cashflow-month-close-v1";
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final List<String> CASHFLOW_IN_LINES = List.of(
        "MYSC_PREPAY_IN",
        "SALES_IN",
        "SALES_VAT_IN",
        "TEAM_SUPPORT_IN",
        "BANK_INTEREST_IN"
    );
    private static final List<String> CASHFLOW_OUT_LINES = List.of(
        "DIRECT_COST_OUT",
        "INPUT_VAT_OUT",
        "MYSC_LABOR_OUT",
        "MYSC_PROFIT_OUT",
        "SALES_VAT_OUT",
        "TEAM_SUPPORT_OUT",
        "BANK_INTEREST_OUT"
    );

    private final Firestore db;
    private final String firestoreProjectId;
    private final Clock clock;
    private final CashflowMonthCloseBusinessDate cashflowMonthCloseBusinessDate;
    private final FirestoreWeeklyExpenseDocumentMapper sheetMapper = new FirestoreWeeklyExpenseDocumentMapper();
    private final ThreadLocal<Transaction> currentTransaction = new ThreadLocal<>();
    private final ThreadLocal<Map<String, Map<String, Object>>> transactionDocumentCache = new ThreadLocal<>();
    private final ThreadLocal<CashflowLeaseScope> currentCashflowLeaseScope = new ThreadLocal<>();
    private final ThreadLocal<CashflowWriteScope> currentCashflowWriteScope = new ThreadLocal<>();
    private final ThreadLocal<Map<String, String>> currentCashflowMonthStates = new ThreadLocal<>();
    private final ThreadLocal<Map<String, CashflowClosedMonthAmendment>> currentCashflowMonthAmendments = new ThreadLocal<>();

    @Autowired
    public FirestoreInheritedWeeklyExpensePersistence(
        @Value("${weekly.firestore-project-id:}") String firestoreProjectId,
        CashflowMonthCloseBusinessDate cashflowMonthCloseBusinessDate
    ) {
        this(
            createFirestore(firestoreProjectId),
            normalizeFirestoreProjectId(firestoreProjectId),
            Clock.systemUTC(),
            cashflowMonthCloseBusinessDate
        );
    }

    FirestoreInheritedWeeklyExpensePersistence(Firestore db, String firestoreProjectId, Clock clock) {
        this(db, firestoreProjectId, clock, new CashflowMonthCloseBusinessDate(null));
    }

    FirestoreInheritedWeeklyExpensePersistence(
        Firestore db,
        String firestoreProjectId,
        Clock clock,
        LocalDate cashflowMonthCloseQaDate
    ) {
        this(db, firestoreProjectId, clock, new CashflowMonthCloseBusinessDate(cashflowMonthCloseQaDate));
    }

    private FirestoreInheritedWeeklyExpensePersistence(
        Firestore db,
        String firestoreProjectId,
        Clock clock,
        CashflowMonthCloseBusinessDate cashflowMonthCloseBusinessDate
    ) {
        this.db = db;
        this.firestoreProjectId = normalizeFirestoreProjectId(firestoreProjectId);
        this.clock = clock;
        this.cashflowMonthCloseBusinessDate = cashflowMonthCloseBusinessDate;
    }

    private static String normalizeFirestoreProjectId(String firestoreProjectId) {
        String projectId = firestoreProjectId == null ? "" : firestoreProjectId.trim();
        if (projectId.isBlank()) {
            throw new IllegalStateException("weekly.firestore-project-id is required when weekly.storage-backend=firestore.");
        }
        return projectId;
    }

    private static Firestore createFirestore(String firestoreProjectId) {
        String projectId = normalizeFirestoreProjectId(firestoreProjectId);
        try {
            return FirestoreOptions.newBuilder()
                .setProjectId(projectId)
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .build()
                .getService();
        } catch (IOException error) {
            throw new IllegalStateException("Could not initialize Firestore credentials.", error);
        }
    }

    @Override
    public <T> T runCommandTransaction(Callable<T> action) {
        if (currentTransaction.get() != null) {
            return call(action);
        }
        try {
            return db.runTransaction(transaction -> {
                currentTransaction.set(transaction);
                transactionDocumentCache.set(new LinkedHashMap<>());
                currentCashflowLeaseScope.remove();
                currentCashflowWriteScope.remove();
                currentCashflowMonthStates.set(new LinkedHashMap<>());
                currentCashflowMonthAmendments.set(new LinkedHashMap<>());
                try {
                    T result = call(action);
                    releaseCashflowLeaseAfterSuccessfulFinalCommand();
                    return result;
                } finally {
                    currentCashflowLeaseScope.remove();
                    currentCashflowWriteScope.remove();
                    currentCashflowMonthStates.remove();
                    currentCashflowMonthAmendments.remove();
                    currentTransaction.remove();
                    transactionDocumentCache.remove();
                }
            }).get();
        } catch (RuntimeException error) {
            throw error;
        } catch (Exception error) {
            Throwable cause = error.getCause();
            if (cause instanceof RuntimeException runtime) {
                throw runtime;
            }
            if (cause instanceof Error fatal) {
                throw fatal;
            }
            throw new IllegalStateException("Firestore weekly expense command transaction failed.", error);
        }
    }

    @Override
    public void requireCashflowDataProject(String dataProjectId) {
        if (!firestoreProjectId.equals(dataProjectId == null ? "" : dataProjectId.trim())) {
            throw leaseError(503, "cashflow_data_project_mismatch", "BFF and JVM cashflow data projects do not match.");
        }
    }

    @Override
    public String requireCashflowWriteLease(
        TrustedActorContext actor,
        String projectId,
        CashflowEditSession session
    ) {
        if (currentTransaction.get() == null) {
            throw leaseError(503, "cashflow_edit_lease_transaction_required", "Cashflow lease validation must run inside the canonical Firestore transaction.");
        }
        if (session == null) {
            throw leaseError(503, "cashflow_data_project_mismatch", "BFF and JVM cashflow data projects do not match.");
        }
        requireCashflowDataProject(session.dataProjectId());
        if (session.sessionId().isBlank() || session.leaseId().isBlank() || session.fence() < 1) {
            throw leaseError(400, "cashflow_edit_lease_request_invalid", "Cashflow edit lease headers are required.");
        }

        String storedRole = requireCashflowWritePermission(actor, projectId);

        DocumentSnapshot leaseSnap = get(db.document(cashflowLeasePath(actor.tenantId(), projectId)));
        if (!leaseSnap.exists()) {
            throw leaseError(410, "edit_lease_expired", "The cashflow edit lease has expired.");
        }
        Map<String, Object> lease = data(leaseSnap);
        Instant expiresAt = instant(lease.get("expiresAt"));
        if (!"ACTIVE".equals(text(lease.get("state"), "").toUpperCase(Locale.ROOT))
            || expiresAt == null
            || !expiresAt.isAfter(clock.instant())) {
            throw leaseError(410, "edit_lease_expired", "The cashflow edit lease has expired.");
        }
        if (!actor.tenantId().equals(text(lease.get("tenantId"), ""))
            || !"cashflow".equals(text(lease.get("resourceType"), ""))
            || !projectId.equals(text(lease.get("resourceId"), ""))
            || !actor.id().equals(text(lease.get("holderUid"), ""))
            || !session.sessionId().equals(text(lease.get("sessionId"), ""))
            || !session.leaseId().equals(text(lease.get("leaseId"), ""))
            || session.fence() != longValue(lease.get("fence"), 0)) {
            throw leaseError(423, "edit_lease_held", "The cashflow edit lease is held by another session.");
        }
        currentCashflowLeaseScope.set(new CashflowLeaseScope(
            actor.tenantId(),
            projectId,
            actor.id(),
            session.sessionId(),
            session.leaseId(),
            session.fence(),
            session.finalizeLease()
        ));
        return storedRole;
    }

    @Override
    public String requireCashflowWritePermission(TrustedActorContext actor, String projectId) {
        return requireCashflowPermission(actor, projectId, false);
    }

    @Override
    public String requireCashflowMonthClosePermission(TrustedActorContext actor, String projectId) {
        return requireCashflowPermission(actor, projectId, true);
    }

    private String requireCashflowPermission(TrustedActorContext actor, String projectId, boolean monthCloseOnly) {
        if (currentTransaction.get() == null) {
            throw leaseError(
                503,
                "cashflow_write_permission_transaction_required",
                "Cashflow write permission validation must run inside the canonical Firestore transaction."
            );
        }

        DocumentSnapshot projectSnap = get(db.document("orgs/" + actor.tenantId() + "/projects/" + projectId));
        Map<String, Object> project = projectSnap.exists() ? data(projectSnap) : Map.of();
        if (project.isEmpty()
            || (!text(project.get("id"), "").isBlank() && !projectId.equals(text(project.get("id"), "")))
            || (!text(project.get("tenantId"), "").isBlank() && !actor.tenantId().equals(text(project.get("tenantId"), "")))) {
            throw leaseError(403, "cashflow_project_write_forbidden", "Canonical project access is required for cashflow writes.");
        }

        DocumentSnapshot memberSnap = get(db.document("orgs/" + actor.tenantId() + "/members/" + actor.id()));
        Map<String, Object> member = memberSnap.exists() ? data(memberSnap) : Map.of();
        String storedRole = requireStoredCashflowWriter(
            member,
            actor,
            projectId,
            monthCloseOnly && actor.id().equals(text(project.get("executiveApproverId"), ""))
        );
        currentCashflowWriteScope.set(new CashflowWriteScope(actor.tenantId(), projectId, actor.id()));
        return storedRole;
    }

    @Override
    public void requireCashflowMonthsOpen(
        String tenantId,
        String projectId,
        Collection<String> yearMonths
    ) {
        if (currentTransaction.get() == null) {
            throw leaseError(
                503,
                "cashflow_month_guard_transaction_required",
                "Cashflow month validation must run inside the canonical Firestore transaction."
            );
        }
        requireValidatedCashflowWriteScope(tenantId, projectId);
        List<String> months = (yearMonths == null ? List.<String>of() : yearMonths.stream()
            .filter(value -> value != null && !value.isBlank())
            .map(String::trim)
            .distinct()
            .sorted()
            .toList());
        for (String yearMonth : months) {
            requireYearMonth(yearMonth);
            String key = monthStateKey(tenantId, projectId, yearMonth);
            Map<String, String> states = currentCashflowMonthStates.get();
            String status = states == null ? null : states.get(key);
            if (status == null) {
                DocumentSnapshot close = get(db.document(monthlyClosePath(tenantId, projectId, yearMonth)));
                status = close.exists()
                    ? canonicalMonthStatus(data(close), tenantId, projectId, yearMonth)
                    : "OPEN";
                if (states != null) states.put(key, status);
            }
            if ("CLOSED".equals(status) && isAuthorizedCashflowMonthAmendment(key)) {
                continue;
            }
            requireMutableMonthStatus(status);
        }
    }

    @Override
    public List<CashflowClosedMonthAmendment> authorizeCashflowSheetMonthAmendments(
        TrustedActorContext actor,
        String projectId,
        Collection<String> yearMonths,
        String sourceRevision,
        String reason,
        String idempotencyKey
    ) {
        requireValidatedCashflowWriteScope(actor.tenantId(), projectId);
        List<String> months = (yearMonths == null ? List.<String>of() : yearMonths.stream()
            .filter(value -> value != null && !value.isBlank())
            .map(String::trim)
            .distinct()
            .sorted()
            .toList());
        if (months.isEmpty()) return List.of();

        CashflowBusinessDate businessDate = cashflowMonthCloseBusinessDate(actor.tenantId(), projectId);
        String requestedReason = text(reason, "").trim();
        List<CashflowClosedMonthAmendment> amendments = new ArrayList<>();
        Map<String, CashflowClosedMonthAmendment> authorized = currentCashflowMonthAmendments.get();
        for (String yearMonth : months) {
            requireYearMonth(yearMonth);
            String key = monthStateKey(actor.tenantId(), projectId, yearMonth);
            Map<String, String> states = currentCashflowMonthStates.get();
            String status = states == null ? null : states.get(key);
            DocumentReference closeRef = db.document(monthlyClosePath(actor.tenantId(), projectId, yearMonth));
            DocumentSnapshot closeSnapshot = get(closeRef);
            Map<String, Object> close = closeSnapshot.exists() ? data(closeSnapshot) : Map.of();
            if (status == null) {
                status = close.isEmpty() ? "OPEN" : canonicalMonthStatus(close, actor.tenantId(), projectId, yearMonth);
                if (states != null) states.put(key, status);
            }
            if (!"CLOSED".equals(status)) continue;
            LocalDate deadline = YearMonth.parse(yearMonth).plusMonths(1).atDay(10);
            boolean postDeadline = businessDate.date().isAfter(deadline);
            if (postDeadline && requestedReason.isBlank()) {
                throw new WeeklyExpenseEditLeaseException(
                    409,
                    "cashflow_closed_month_reason_required",
                    yearMonth + " 마감 후 변경 사유를 입력해 주세요."
                );
            }
            long closeRevision = canonicalMonthCounter(close, "revision");
            long amendmentCount = addMonthCounters(optionalMonthCounter(close, "amendmentCount"), 1);
            long warningCount = addMonthCounters(optionalMonthCounter(close, "postDeadlineAmendmentWarningCount"), postDeadline ? 1 : 0);
            CashflowClosedMonthAmendment amendment = new CashflowClosedMonthAmendment(
                yearMonth,
                closeRevision,
                deadline.toString(),
                postDeadline,
                amendmentCount,
                warningCount
            );
            if (authorized != null) authorized.put(key, amendment);
            amendments.add(amendment);
        }
        return List.copyOf(amendments);
    }

    @Override
    public void recordCashflowSheetMonthAmendments(
        TrustedActorContext actor,
        String projectId,
        List<CashflowClosedMonthAmendment> amendments,
        String sourceRevision,
        String reason,
        String idempotencyKey
    ) {
        String requestedReason = text(reason, "").trim();
        String normalizedReason = requestedReason.isBlank()
            ? "시트 고정본 " + text(sourceRevision, "unknown")
            : requestedReason;
        String actorName = text(actor.name(), text(actor.email(), actor.id()));
        Instant now = clock.instant();
        for (CashflowClosedMonthAmendment amendment : amendments == null ? List.<CashflowClosedMonthAmendment>of() : amendments) {
            set(db.document(monthlyClosePath(actor.tenantId(), projectId, amendment.yearMonth())), Map.of(
                "amendmentCount", amendment.amendmentCount(),
                "postDeadlineAmendmentWarningCount", amendment.warningCount(),
                "lastAmendmentAt", now.toString(),
                "lastAmendmentByUid", actor.id(),
                "lastAmendmentByName", actorName,
                "lastAmendmentReason", normalizedReason,
                "lastAmendmentDeadline", amendment.deadline(),
                "lastAmendmentPostDeadline", amendment.postDeadline()
            ));
            String amendmentId = safeDocId(projectId + "\n" + amendment.yearMonth() + "\n" + idempotencyKey);
            Map<String, Object> amendmentDocument = new LinkedHashMap<>();
            amendmentDocument.put("id", amendmentId);
            amendmentDocument.put("tenantId", actor.tenantId());
            amendmentDocument.put("projectId", projectId);
            amendmentDocument.put("yearMonth", amendment.yearMonth());
            amendmentDocument.put("closeRevision", amendment.closeRevision());
            amendmentDocument.put("deadline", amendment.deadline());
            amendmentDocument.put("postDeadline", amendment.postDeadline());
            amendmentDocument.put("sourceRevision", sourceRevision);
            amendmentDocument.put("reason", normalizedReason);
            amendmentDocument.put("warningCount", amendment.warningCount());
            amendmentDocument.put("actorUid", actor.id());
            amendmentDocument.put("actorName", actorName);
            amendmentDocument.put("idempotencyKey", idempotencyKey);
            amendmentDocument.put("createdAt", now.toString());
            set(db.document("orgs/" + actor.tenantId() + "/cashflow_month_amendments/" + amendmentId), amendmentDocument);
        }
    }

    private long optionalMonthCounter(Map<String, Object> close, String field) {
        return close.containsKey(field) ? canonicalMonthCounter(close, field) : 0;
    }

    @Override
    public void requireCashflowWeeksOpen(
        String tenantId,
        String projectId,
        Collection<CashflowWeekScope> weeks
    ) {
        if (currentTransaction.get() == null) {
            throw leaseError(
                503,
                "cashflow_week_guard_transaction_required",
                "Cashflow week validation must run inside the canonical Firestore transaction."
            );
        }
        requireValidatedCashflowWriteScope(tenantId, projectId);
        List<CashflowWeekScope> scopes = (weeks == null ? List.<CashflowWeekScope>of() : weeks.stream()
            .filter(Objects::nonNull)
            .distinct()
            .sorted(Comparator.comparing(CashflowWeekScope::yearMonth).thenComparingInt(CashflowWeekScope::weekNo))
            .toList());
        List<String> locked = new ArrayList<>();
        for (CashflowWeekScope scope : scopes) {
            requireYearMonth(scope.yearMonth());
            if (scope.weekNo() < 1 || scope.weekNo() > CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) {
                throw new IllegalArgumentException("Cashflow weekNo must be between 1 and 5.");
            }
            if (isAuthorizedCashflowMonthAmendment(monthStateKey(tenantId, projectId, scope.yearMonth()))) {
                continue;
            }
            String documentId = projectId + "-" + scope.yearMonth() + "-w" + scope.weekNo();
            DocumentReference ref = db.document(cashflowWeeklyUpdateCompletionPath(tenantId, documentId));
            Map<String, Object> document = cachedDocumentIfPresent(ref).orElseGet(() -> {
                DocumentSnapshot snapshot = get(ref);
                return snapshot.exists() ? data(snapshot) : Map.of();
            });
            if ("LOCKED".equals(text(document.get("status"), ""))) {
                locked.add(scope.yearMonth() + " " + scope.weekNo() + "주차");
            }
        }
        if (!locked.isEmpty()) {
            throw new WeeklyExpenseConflictException(
                "Cashflow week is locked: " + String.join(", ", locked)
                    + ". Reopen it with a reason before changing values."
            );
        }
    }

    @Override
    public CashflowMonthCloseRecord findCashflowMonthClose(
        String tenantId,
        String projectId,
        String yearMonth
    ) {
        requireYearMonth(yearMonth);
        DocumentSnapshot close = get(db.document(monthlyClosePath(tenantId, projectId, yearMonth)));
        List<Map<String, Object>> projectCloses = readProjectMonthCloses(tenantId, projectId);
        Map<String, Object> document = close.exists() ? data(close) : Map.of();
        if (!document.isEmpty()) canonicalMonthStatus(document, tenantId, projectId, yearMonth);
        return toMonthCloseRecord(tenantId, projectId, yearMonth, document, projectWarningCount(projectCloses));
    }

    @Override
    public CashflowVarianceRecord updateCashflowVariance(
        TrustedActorContext actor,
        String projectId,
        CashflowVarianceRequest request
    ) {
        requireValidatedCashflowWriteScope(actor.tenantId(), projectId);
        if (request.expectedRevision() == null) {
            throw new IllegalArgumentException("expectedRevision is required.");
        }
        long expectedRevision = request.expectedRevision();
        if (expectedRevision < 0 || expectedRevision > MAX_SAFE_INTEGER) {
            throw new IllegalArgumentException("expectedRevision must be a non-negative safe integer.");
        }

        DocumentReference weekRef = cashflowWeekRef(actor.tenantId(), request.sheetId());
        DocumentSnapshot weekSnapshot = get(weekRef);
        if (!weekSnapshot.exists()) {
            throw leaseError(404, "not_found", "Cashflow week not found for this project.");
        }
        Map<String, Object> week = data(weekSnapshot);
        if (!projectId.equals(text(week.get("projectId"), ""))) {
            throw leaseError(404, "not_found", "Cashflow week not found for this project.");
        }
        String yearMonth = text(week.get("yearMonth"), "");
        requireYearMonth(yearMonth);
        requireCashflowVarianceMonthOpen(actor.tenantId(), projectId, yearMonth);

        long currentRevision = cashflowVarianceRevision(week);
        if (currentRevision != expectedRevision) {
            throw leaseError(
                409,
                "cashflow_metadata_version_conflict",
                "Cashflow metadata revision mismatch: expected " + expectedRevision + ", actual " + currentRevision + "."
            );
        }
        if (currentRevision == MAX_SAFE_INTEGER) {
            throw leaseError(
                409,
                "cashflow_metadata_version_conflict",
                "Cashflow metadata revision exceeds the supported safe-integer range."
            );
        }

        Map<String, Object> previousFlag = cashflowVarianceFlag(week.get("varianceFlag"));
        String previousStatus = text(previousFlag.get("status"), "");
        if ("FLAG".equals(request.action()) && !previousFlag.isEmpty() && !"RESOLVED".equals(previousStatus)) {
            throw leaseError(409, "cashflow_variance_state_conflict", "An unresolved variance review already exists.");
        }
        if ("REPLY".equals(request.action()) && !"OPEN".equals(previousStatus)) {
            throw leaseError(409, "cashflow_variance_state_conflict", "Only an open variance review can be replied to.");
        }
        if ("RESOLVE".equals(request.action()) && !"REPLIED".equals(previousStatus)) {
            throw leaseError(409, "cashflow_variance_state_conflict", "Only a replied variance review can be resolved.");
        }

        long revision = currentRevision + 1;
        String timestamp = clock.instant().toString();
        String displayName = cashflowActorDisplayName(actor);
        Map<String, Object> varianceFlag = new LinkedHashMap<>(previousFlag);
        if ("FLAG".equals(request.action())) {
            varianceFlag.clear();
            varianceFlag.put("status", "OPEN");
            varianceFlag.put("reason", request.content());
            varianceFlag.put("flaggedBy", displayName);
            varianceFlag.put("flaggedByUid", actor.id());
            varianceFlag.put("flaggedAt", timestamp);
        } else if ("REPLY".equals(request.action())) {
            varianceFlag.put("status", "REPLIED");
            varianceFlag.put("pmReply", request.content());
            varianceFlag.put("pmRepliedBy", displayName);
            varianceFlag.put("pmRepliedByUid", actor.id());
            varianceFlag.put("pmRepliedAt", timestamp);
        } else {
            varianceFlag.put("status", "RESOLVED");
            varianceFlag.put("resolvedBy", displayName);
            varianceFlag.put("resolvedByUid", actor.id());
            varianceFlag.put("resolvedAt", timestamp);
        }

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("id", "vf-" + revision);
        event.put("action", request.action());
        event.put("actor", displayName);
        event.put("actorUid", actor.id());
        event.put("content", "RESOLVE".equals(request.action()) && request.content().isBlank()
            ? "해결 처리"
            : request.content());
        event.put("timestamp", timestamp);
        List<Map<String, Object>> history = new ArrayList<>(cashflowVarianceHistory(week.get("varianceHistory")));
        history.add(event);

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("tenantId", actor.tenantId());
        patch.put("projectId", projectId);
        patch.put("yearMonth", yearMonth);
        patch.put("varianceFlag", varianceFlag);
        patch.put("varianceHistory", history);
        patch.put("varianceRevision", revision);
        patch.put("updatedAt", timestamp);
        patch.put("updatedByUid", actor.id());
        patch.put("updatedByName", displayName);
        set(weekRef, patch);
        return new CashflowVarianceRecord(
            request.sheetId(),
            projectId,
            actor.tenantId(),
            yearMonth,
            varianceFlag,
            history,
            revision,
            timestamp,
            actor.id(),
            displayName
        );
    }

    @Override
    public CashflowMonthCloseRecord closeCashflowMonth(
        TrustedActorContext actor,
        String projectId,
        String sourceSheetKey,
        CloseCashflowMonthRequest request
    ) {
        requireValidatedCashflowWriteScope(actor.tenantId(), projectId);
        YearMonth targetMonth = requireYearMonth(request.yearMonth());
        CashflowBusinessDate businessDate = cashflowMonthCloseBusinessDate(actor.tenantId(), projectId);
        LocalDate today = businessDate.date();
        if (!targetMonth.isBefore(YearMonth.from(today))) {
            throw new WeeklyExpenseConflictException("Cashflow month close is available after the target month ends.");
        }

        List<CashflowSheetLabApplyRequest.Cell> cells = CashflowSheetLabApplyRequest.requireCompleteMonth(request.cells());
        List<CloseCashflowMonthRequest.DepositScheduleRow> depositScheduleRows = CloseCashflowMonthRequest
            .requireCompleteDepositSchedule(request.depositScheduleRows());
        List<CloseCashflowMonthRequest.Confirmation> confirmations = CloseCashflowMonthRequest
            .requireCompleteConfirmations(request.confirmations());
        CloseCashflowMonthRequest.requireCompleteManagementChecks(request.managementChecks());
        CloseCashflowMonthRequest.requireCompleteManagementConfirmations(request.managementConfirmations());
        requireConfirmationStatesMatchCells(cells, confirmations);
        ValidatedCloseSource source = requirePinnedCloseSource(actor, projectId, request);

        DocumentReference closeRef = db.document(monthlyClosePath(actor.tenantId(), projectId, request.yearMonth()));
        DocumentSnapshot closeSnapshot = get(closeRef);
        Map<String, Object> current = closeSnapshot.exists() ? data(closeSnapshot) : Map.of();
        String currentStatus = current.isEmpty()
            ? "OPEN"
            : canonicalMonthStatus(current, actor.tenantId(), projectId, request.yearMonth());
        requireMutableMonthStatus(currentStatus);
        long currentRevision = current.isEmpty() ? 0 : canonicalMonthCounter(current, "revision");
        if (currentRevision != request.expectedRevision()) {
            throw new WeeklyExpenseConflictException("Cashflow month close revision changed. Reload before closing.");
        }
        List<Map<String, Object>> projectCloses = readProjectMonthCloses(actor.tenantId(), projectId);
        long warningCount = projectWarningCount(projectCloses);
        long reopenCount = current.isEmpty() ? 0 : canonicalMonthCounter(current, "reopenCount");
        long revision = addMonthCounters(currentRevision, 1);

        CashflowSheetMonthReplacement replacement = replaceCashflowSheetMonthForMonthClose(
            actor.tenantId(),
            projectId,
            sourceSheetKey,
            request.yearMonth(),
            request.targetRevision(),
            cells
        );
        Instant now = clock.instant();
        Map<String, Object> snapshot = buildMonthCloseSnapshot(
            actor,
            projectId,
            request,
            depositScheduleRows,
            confirmations,
            replacement,
            source,
            now,
            today,
            businessDate.qaOverrideActive()
        );
        if (!nestedMap(current.get("reopenRequest")).isEmpty() || !nestedMap(current.get("reopenDecision")).isEmpty()) {
            snapshot.put("reopenContext", Map.of(
                "request", nestedMap(current.get("reopenRequest")),
                "decision", nestedMap(current.get("reopenDecision"))
            ));
        }
        String snapshotHash = hashCanonicalJson(snapshot);
        String previousSnapshotHash = text(current.get("snapshotHash"), "");
        boolean late = today.isAfter(targetMonth.plusMonths(1).atDay(10));
        String versionId = projectId + "-" + request.yearMonth() + "-r" + revision;
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("id", projectId + "-" + request.yearMonth());
        patch.put("contractVersion", CASHFLOW_MONTH_CLOSE_CONTRACT_VERSION);
        patch.put("tenantId", actor.tenantId());
        patch.put("projectId", projectId);
        patch.put("yearMonth", request.yearMonth());
        patch.put("status", "CLOSED");
        patch.put("revision", revision);
        patch.put("reopenCount", reopenCount);
        patch.put("snapshot", snapshot);
        patch.put("previousSnapshot", nestedMap(current.get("snapshot")));
        patch.put("snapshotHash", snapshotHash);
        patch.put("previousSnapshotHash", previousSnapshotHash);
        patch.put("latestVersionId", versionId);
        patch.put("late", late);
        patch.put("closedAt", now.toString());
        patch.put("closedByUid", actor.id());
        patch.put("closedByName", actor.name());
        patch.put("reopenRequest", Map.of());
        patch.put("reopenDecision", Map.of());
        patch.put("createdAt", text(current.get("createdAt"), now.toString()));
        patch.put("updatedAt", now.toString());
        set(closeRef, patch);
        Map<String, Object> version = new LinkedHashMap<>();
        version.put("id", versionId);
        version.put("contractVersion", CASHFLOW_MONTH_CLOSE_CONTRACT_VERSION);
        version.put("schemaVersion", 1);
        version.put("tenantId", actor.tenantId());
        version.put("projectId", projectId);
        version.put("yearMonth", request.yearMonth());
        version.put("status", "CLOSED");
        version.put("revision", revision);
        version.put("reopenCount", reopenCount);
        version.put("snapshot", snapshot);
        version.put("snapshotHash", snapshotHash);
        version.put("previousSnapshotHash", previousSnapshotHash);
        version.put("sourceRevision", request.sourceRevision());
        version.put("targetRevision", request.targetRevision());
        version.put("late", late);
        version.put("closedAt", now.toString());
        version.put("closedByUid", actor.id());
        version.put("closedByName", actor.name());
        set(db.document(monthlyCloseVersionPath(actor.tenantId(), versionId)), version);
        currentCashflowMonthStates.get().put(
            monthStateKey(actor.tenantId(), projectId, request.yearMonth()),
            "CLOSED"
        );
        return toMonthCloseRecord(actor.tenantId(), projectId, request.yearMonth(), merge(current, patch), warningCount);
    }

    @Override
    public CashflowWeeklyUpdateCompletionRecord findCashflowWeeklyUpdateCompletion(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo
    ) {
        requireYearMonth(yearMonth);
        if (weekNo < 1 || weekNo > CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) {
            throw new IllegalArgumentException("Cashflow weekNo must be between 1 and 5.");
        }
        String documentId = projectId + "-" + yearMonth + "-w" + weekNo;
        DocumentSnapshot snapshot = get(db.document(cashflowWeeklyUpdateCompletionPath(tenantId, documentId)));
        if (!snapshot.exists()) {
            return toWeeklyCompletionRecord(projectId, yearMonth, weekNo, Map.of(), false);
        }
        Map<String, Object> document = data(snapshot);
        if (!projectId.equals(text(document.get("projectId"), ""))
            || !yearMonth.equals(text(document.get("yearMonth"), ""))
            || weekNo != intValue(document.get("weekNo"), 0)) {
            throw new WeeklyExpenseConflictException("Stored weekly cashflow completion scope is invalid.");
        }
        DocumentSnapshot monthClose = get(db.document(monthlyClosePath(tenantId, projectId, yearMonth)));
        boolean monthClosed = monthClose.exists()
            && "CLOSED".equals(canonicalMonthStatus(data(monthClose), tenantId, projectId, yearMonth));
        requireWeeklyCompletionIntegrity(tenantId, projectId, yearMonth, weekNo, document, !monthClosed);
        return toWeeklyCompletionRecord(projectId, yearMonth, weekNo, document, false);
    }

    @Override
    public CashflowWeeklyUpdateCompletionRecord completeCashflowWeeklyUpdate(
        TrustedActorContext actor,
        String projectId,
        CompleteCashflowWeeklyUpdateRequest request
    ) {
        requireValidatedCashflowWriteScope(actor.tenantId(), projectId);
        requireYearMonth(request.yearMonth());
        if (request.weekNo() < 1 || request.weekNo() > CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) {
            throw new IllegalArgumentException("Cashflow weekNo must be between 1 and 5.");
        }
        requireCashflowMonthsOpen(actor.tenantId(), projectId, List.of(request.yearMonth()));
        Instant completedAt;
        try {
            completedAt = Instant.parse(request.completedAt());
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("completedAt must use an ISO-8601 instant.", error);
        }
        String documentId = projectId + "-" + request.yearMonth() + "-w" + request.weekNo();
        DocumentReference ref = db.document(cashflowWeeklyUpdateCompletionPath(actor.tenantId(), documentId));
        DocumentSnapshot snapshot = get(ref);
        if (snapshot.exists()) {
            Map<String, Object> existing = data(snapshot);
            if (!projectId.equals(text(existing.get("projectId"), ""))
                || !request.yearMonth().equals(text(existing.get("yearMonth"), ""))
                || request.weekNo() != intValue(existing.get("weekNo"), 0)) {
                throw new WeeklyExpenseConflictException("Stored weekly cashflow completion scope is invalid.");
            }
            if ("LOCKED".equals(text(existing.get("status"), ""))) {
                requireWeeklyCompletionIntegrity(
                    actor.tenantId(),
                    projectId,
                    request.yearMonth(),
                    request.weekNo(),
                    existing,
                    true
                );
                return toWeeklyCompletionRecord(projectId, request.yearMonth(), request.weekNo(), existing, true);
            }
        }

        QuerySnapshot projectWeekSnapshot = query(cashflowWeeks(actor.tenantId()).whereEqualTo("projectId", projectId));
        Map<String, Map<String, Object>> projectWeeks = new LinkedHashMap<>();
        for (DocumentSnapshot weekSnapshot : projectWeekSnapshot.getDocuments()) {
            Map<String, Object> week = data(weekSnapshot);
            WeekDocParts parts = parseCashflowWeekId(projectId, weekSnapshot.getId());
            requireCanonicalCashflowMonthDocument(
                projectId,
                parts.yearMonth(),
                parts.weekNo(),
                weekSnapshot.getId(),
                week
            );
            projectWeeks.put(weekSnapshot.getId(), week);
        }
        String weekId = cashflowWeekId(projectId, request.yearMonth(), request.weekNo());
        Map<String, Object> week = projectWeeks.getOrDefault(
            weekId,
            baseCashflowWeekDoc(actor.tenantId(), projectId, weekId)
        );
        String targetRevision = computeCashflowTargetRevision(projectWeeks.values());
        DocumentSnapshot mirrorSnapshot = get(db.document(
            "orgs/" + actor.tenantId() + "/cashflow_sheet_mirrors/" + projectId
        ));
        String sourceRevision = mirrorSnapshot.exists()
            ? text(data(mirrorSnapshot).get("sourceRevision"), "")
            : "";
        Map<String, Object> lockedSnapshot = new LinkedHashMap<>();
        lockedSnapshot.put("schemaVersion", 1);
        lockedSnapshot.put("projectId", projectId);
        lockedSnapshot.put("yearMonth", request.yearMonth());
        lockedSnapshot.put("weekNo", request.weekNo());
        lockedSnapshot.put("projection", revisionAmounts(week.get("projection")));
        lockedSnapshot.put("actual", revisionAmounts(week.get("actual")));
        lockedSnapshot.put("projectionTotals", nestedMap(week.get("projectionTotals")));
        lockedSnapshot.put("actualTotals", nestedMap(week.get("actualTotals")));
        lockedSnapshot.put("weeklyExpenseActualBySheet", revisionAmountSources(week.get("weeklyExpenseActualBySheet")));
        lockedSnapshot.put("adminClosed", revisionBoolean(week.get("adminClosed")));
        lockedSnapshot.put("sourceRevision", sourceRevision);
        lockedSnapshot.put("targetRevision", targetRevision);
        String snapshotHash = hashCanonicalJson(lockedSnapshot);
        Map<String, Object> existing = snapshot.exists() ? data(snapshot) : Map.of();
        long revision = Math.addExact(longValue(existing.get("revision"), 0), 1);
        long reopenCount = longValue(existing.get("reopenCount"), 0);
        String completedBy = actor.email().isBlank() ? actor.id() : actor.email();
        Map<String, Object> completion = new LinkedHashMap<>();
        completion.put("id", documentId);
        completion.put("tenantId", actor.tenantId());
        completion.put("projectId", projectId);
        completion.put("yearMonth", request.yearMonth());
        completion.put("weekNo", request.weekNo());
        completion.put("status", "LOCKED");
        completion.put("revision", revision);
        completion.put("reopenCount", reopenCount);
        completion.put("snapshot", lockedSnapshot);
        completion.put("snapshotHash", snapshotHash);
        completion.put("previousSnapshotHash", text(existing.get("snapshotHash"), ""));
        completion.put("sourceRevision", sourceRevision);
        completion.put("targetRevision", targetRevision);
        completion.put("completedAt", completedAt.toString());
        completion.put("completedByUid", actor.id());
        completion.put("completedByEmail", actor.email());
        completion.put("completedByName", actor.name());
        completion.put("reopenedAt", "");
        completion.put("reopenedByUid", "");
        completion.put("reopenedByName", "");
        completion.put("reopenReason", "");
        completion.put("createdAt", text(existing.get("createdAt"), clock.instant().toString()));
        completion.put("updatedAt", clock.instant().toString());
        set(ref, completion);
        String versionId = documentId + "-r" + revision;
        Map<String, Object> version = new LinkedHashMap<>(completion);
        version.put("id", versionId);
        version.put("completedBy", completedBy);
        set(db.document(cashflowWeeklyUpdateCompletionVersionPath(actor.tenantId(), versionId)), version);
        return toWeeklyCompletionRecord(projectId, request.yearMonth(), request.weekNo(), completion, false);
    }

    @Override
    public CashflowWeeklyUpdateCompletionRecord reopenCashflowWeeklyUpdate(
        TrustedActorContext actor,
        String projectId,
        ReopenCashflowWeeklyUpdateRequest request
    ) {
        requireValidatedCashflowWriteScope(actor.tenantId(), projectId);
        requireYearMonth(request.yearMonth());
        if (request.reason() == null || request.reason().isBlank()) {
            throw new IllegalArgumentException("A reason is required to reopen a cashflow week.");
        }
        requireCashflowMonthsOpen(actor.tenantId(), projectId, List.of(request.yearMonth()));
        String documentId = projectId + "-" + request.yearMonth() + "-w" + request.weekNo();
        DocumentReference ref = db.document(cashflowWeeklyUpdateCompletionPath(actor.tenantId(), documentId));
        DocumentSnapshot snapshot = get(ref);
        if (!snapshot.exists()) {
            throw new WeeklyExpenseConflictException("Only a locked cashflow week can be reopened.");
        }
        Map<String, Object> current = data(snapshot);
        if (!projectId.equals(text(current.get("projectId"), ""))
            || !request.yearMonth().equals(text(current.get("yearMonth"), ""))
            || request.weekNo() != intValue(current.get("weekNo"), 0)) {
            throw new WeeklyExpenseConflictException("Stored weekly cashflow completion scope is invalid.");
        }
        if (!"LOCKED".equals(text(current.get("status"), ""))) {
            throw new WeeklyExpenseConflictException("Only a locked cashflow week can be reopened.");
        }
        long currentRevision = longValue(current.get("revision"), 0);
        if (currentRevision != request.expectedRevision()) {
            throw new WeeklyExpenseConflictException("Cashflow weekly lock revision changed. Reload before reopening.");
        }
        Instant reopenedAt = clock.instant();
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("status", "OPEN");
        patch.put("revision", Math.addExact(currentRevision, 1));
        patch.put("reopenCount", Math.addExact(longValue(current.get("reopenCount"), 0), 1));
        patch.put("reopenedAt", reopenedAt.toString());
        patch.put("reopenedByUid", actor.id());
        patch.put("reopenedByName", actor.name());
        patch.put("reopenReason", request.reason().trim());
        patch.put("updatedAt", reopenedAt.toString());
        set(ref, patch);
        return toWeeklyCompletionRecord(
            projectId,
            request.yearMonth(),
            request.weekNo(),
            merge(current, patch),
            false
        );
    }

    @Override
    public CashflowMonthCloseRecord requestCashflowMonthReopen(
        TrustedActorContext actor,
        String projectId,
        RequestCashflowMonthReopenRequest request
    ) {
        requireYearMonth(request.yearMonth());
        DocumentReference closeRef = db.document(monthlyClosePath(actor.tenantId(), projectId, request.yearMonth()));
        DocumentSnapshot snapshot = get(closeRef);
        if (!snapshot.exists()) {
            throw new WeeklyExpenseConflictException("Only a closed cashflow month can be reopened.");
        }
        Map<String, Object> current = data(snapshot);
        if (!"CLOSED".equals(canonicalMonthStatus(current, actor.tenantId(), projectId, request.yearMonth()))) {
            throw new WeeklyExpenseConflictException("Only a closed cashflow month can request reopen.");
        }
        requireExpectedMonthRevision(current, request.expectedRevision());
        List<Map<String, Object>> projectCloses = readProjectMonthCloses(actor.tenantId(), projectId);
        Instant now = clock.instant();
        Map<String, Object> reopenRequest = new LinkedHashMap<>();
        reopenRequest.put("reason", request.reason());
        reopenRequest.put("requestedAt", now.toString());
        reopenRequest.put("requestedByUid", actor.id());
        reopenRequest.put("requestedByName", actor.name());
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("status", "REOPEN_REQUESTED");
        patch.put("revision", addMonthCounters(request.expectedRevision(), 1));
        patch.put("reopenRequest", reopenRequest);
        patch.put("reopenDecision", Map.of());
        patch.put("updatedAt", now.toString());
        set(closeRef, patch);
        return toMonthCloseRecord(
            actor.tenantId(),
            projectId,
            request.yearMonth(),
            merge(current, patch),
            projectWarningCount(projectCloses)
        );
    }

    @Override
    public CashflowMonthCloseRecord decideCashflowMonthReopen(
        TrustedActorContext actor,
        String projectId,
        DecideCashflowMonthReopenRequest request
    ) {
        requireYearMonth(request.yearMonth());
        DocumentReference closeRef = db.document(monthlyClosePath(actor.tenantId(), projectId, request.yearMonth()));
        DocumentSnapshot snapshot = get(closeRef);
        if (!snapshot.exists()) {
            throw new WeeklyExpenseConflictException("Cashflow month reopen request does not exist.");
        }
        Map<String, Object> current = data(snapshot);
        if (!"REOPEN_REQUESTED".equals(canonicalMonthStatus(current, actor.tenantId(), projectId, request.yearMonth()))) {
            throw new WeeklyExpenseConflictException("Cashflow month is not awaiting a reopen decision.");
        }
        requireExpectedMonthRevision(current, request.expectedRevision());
        List<Map<String, Object>> projectCloses = readProjectMonthCloses(actor.tenantId(), projectId);
        boolean approved = "APPROVE".equals(request.decision());
        long reopenCount = addMonthCounters(
            canonicalMonthCounter(current, "reopenCount"),
            approved ? 1 : 0
        );
        long warningCount = addMonthCounters(projectWarningCount(projectCloses), approved ? 1 : 0);
        Instant now = clock.instant();
        Map<DocumentReference, Map<String, Object>> weeklyReopenPatches = new LinkedHashMap<>();
        if (approved) {
            DocumentReference[] weeklyCompletionRefs = java.util.stream.IntStream.rangeClosed(
                    1,
                    CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT
                )
                .mapToObj(weekNo -> db.document(cashflowWeeklyUpdateCompletionPath(
                    actor.tenantId(),
                    projectId + "-" + request.yearMonth() + "-w" + weekNo
                )))
                .toArray(DocumentReference[]::new);
            for (DocumentSnapshot weeklyCompletion : getAll(weeklyCompletionRefs)) {
                if (!weeklyCompletion.exists()) continue;
                Map<String, Object> completion = data(weeklyCompletion);
                int weekNo = intValue(completion.get("weekNo"), 0);
                if (!projectId.equals(text(completion.get("projectId"), ""))
                    || !request.yearMonth().equals(text(completion.get("yearMonth"), ""))
                    || weekNo < 1
                    || weekNo > CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) {
                    throw new WeeklyExpenseConflictException("Stored weekly cashflow completion scope is invalid.");
                }
                if (!"LOCKED".equals(text(completion.get("status"), ""))) continue;
                Map<String, Object> weeklyPatch = new LinkedHashMap<>();
                weeklyPatch.put("status", "OPEN");
                weeklyPatch.put("revision", Math.addExact(longValue(completion.get("revision"), 0), 1));
                weeklyPatch.put("reopenCount", Math.addExact(longValue(completion.get("reopenCount"), 0), 1));
                weeklyPatch.put("reopenedAt", now.toString());
                weeklyPatch.put("reopenedByUid", actor.id());
                weeklyPatch.put("reopenedByName", actor.name());
                weeklyPatch.put("reopenReason", "월 결산 재오픈 승인: " + request.reason().trim());
                weeklyPatch.put("reopenSource", "MONTH_REOPEN_APPROVAL");
                weeklyPatch.put("updatedAt", now.toString());
                weeklyReopenPatches.put(weeklyCompletion.getReference(), weeklyPatch);
            }
        }
        Map<String, Object> decision = new LinkedHashMap<>();
        decision.put("decision", request.decision());
        decision.put("reason", request.reason());
        decision.put("decidedAt", now.toString());
        decision.put("decidedByUid", actor.id());
        decision.put("decidedByName", actor.name());
        decision.put("autoReopenedWeeklyCount", weeklyReopenPatches.size());
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("status", approved ? "OPEN" : "CLOSED");
        patch.put("revision", addMonthCounters(request.expectedRevision(), 1));
        patch.put("reopenCount", reopenCount);
        patch.put("reopenDecision", decision);
        patch.put("updatedAt", now.toString());
        set(closeRef, patch);
        for (Map.Entry<DocumentReference, Map<String, Object>> weeklyReopen : weeklyReopenPatches.entrySet()) {
            set(weeklyReopen.getKey(), weeklyReopen.getValue());
        }
        return toMonthCloseRecord(actor.tenantId(), projectId, request.yearMonth(), merge(current, patch), warningCount);
    }

    private void releaseCashflowLeaseAfterSuccessfulFinalCommand() {
        CashflowLeaseScope scope = currentCashflowLeaseScope.get();
        if (scope == null || !scope.finalizeLease()) return;
        DocumentReference leaseRef = db.document(cashflowLeasePath(scope.tenantId(), scope.projectId()));
        Map<String, Object> lease = cachedDocumentIfPresent(leaseRef)
            .orElseThrow(() -> leaseError(
                503,
                "cashflow_edit_lease_cache_missing",
                "The validated cashflow edit lease is unavailable for atomic finalization."
            ));
        if (!"ACTIVE".equals(text(lease.get("state"), "").toUpperCase(Locale.ROOT))
            || !scope.tenantId().equals(text(lease.get("tenantId"), ""))
            || !"cashflow".equals(text(lease.get("resourceType"), ""))
            || !scope.projectId().equals(text(lease.get("resourceId"), ""))
            || !scope.actorId().equals(text(lease.get("holderUid"), ""))
            || !scope.sessionId().equals(text(lease.get("sessionId"), ""))
            || !scope.leaseId().equals(text(lease.get("leaseId"), ""))
            || scope.fence() != longValue(lease.get("fence"), 0)) {
            throw leaseError(423, "edit_lease_held", "The cashflow edit lease is held by another session.");
        }
        String timestamp = clock.instant().toString();
        set(leaseRef, Map.of(
            "state", "RELEASED",
            "releasedAt", timestamp,
            "releaseReason", "FINAL_SAVE",
            "updatedAt", timestamp
        ));
    }

    @Override
    public int countCashflowActualReplacementWrites(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        List<String> requestedWeekDocumentIds
    ) {
        if (currentTransaction.get() == null) {
            throw leaseError(503, "cashflow_atomic_plan_transaction_required", "Cashflow write planning must run inside the canonical Firestore transaction.");
        }
        requireValidatedCashflowWriteScope(tenantId, projectId);
        Set<String> writeDocumentIds = new java.util.LinkedHashSet<>(requestedWeekDocumentIds == null
            ? List.of()
            : requestedWeekDocumentIds);
        QuerySnapshot existing = query(cashflowWeeks(tenantId).whereEqualTo("projectId", projectId));
        for (DocumentSnapshot doc : existing.getDocuments()) {
            if (data(doc).containsKey("weeklyExpenseActualBySheet")) {
                writeDocumentIds.add(doc.getId());
            }
        }
        return writeDocumentIds.size();
    }

    @Override
    public CashflowSheetMonthReplacement replaceCashflowSheetMonth(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String yearMonth,
        String targetRevision,
        List<CashflowSheetLabApplyRequest.Cell> cells
    ) {
        return replaceCashflowSheetMonth(
            tenantId,
            projectId,
            sourceSheetKey,
            yearMonth,
            targetRevision,
            cells,
            false
        );
    }

    @Override
    public CashflowSheetMonthReplacement replaceCashflowSheetMonth(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String yearMonth,
        String targetRevision,
        List<CashflowSheetLabApplyRequest.Cell> cells,
        boolean replaceAllActualSources
    ) {
        NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> cellsByMonth = new TreeMap<>();
        cellsByMonth.put(yearMonth, CashflowSheetLabApplyRequest.requireCompleteMonth(cells));
        CashflowSheetBatchReplacement replacement = replaceCashflowSheetMonthsInternal(
            tenantId,
            projectId,
            sourceSheetKey,
            targetRevision,
            cellsByMonth,
            replaceAllActualSources,
            false
        );
        CashflowSheetBatchMonthReplacement month = replacement.months().getFirst();
        return new CashflowSheetMonthReplacement(
            month.projection(),
            month.actual(),
            month.weeks(),
            replacement.resultingTargetRevision()
        );
    }

    @Override
    public CashflowSheetBatchReplacement replaceCashflowSheetMonths(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String targetRevision,
        CashflowSheetBatchApplyRequest request
    ) {
        return replaceCashflowSheetMonthsInternal(
            tenantId,
            projectId,
            sourceSheetKey,
            targetRevision,
            CashflowSheetBatchApplyRequest.requireCompleteMonths(request.months()),
            request.replaceAllActualSources(),
            false
        );
    }

    private CashflowSheetMonthReplacement replaceCashflowSheetMonthForMonthClose(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String yearMonth,
        String targetRevision,
        List<CashflowSheetLabApplyRequest.Cell> cells
    ) {
        NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> cellsByMonth = new TreeMap<>();
        cellsByMonth.put(yearMonth, CashflowSheetLabApplyRequest.requireCompleteMonth(cells));
        CashflowSheetBatchReplacement replacement = replaceCashflowSheetMonthsInternal(
            tenantId,
            projectId,
            sourceSheetKey,
            targetRevision,
            cellsByMonth,
            false,
            true
        );
        CashflowSheetBatchMonthReplacement month = replacement.months().getFirst();
        return new CashflowSheetMonthReplacement(
            month.projection(),
            month.actual(),
            month.weeks(),
            replacement.resultingTargetRevision()
        );
    }

    private CashflowSheetBatchReplacement replaceCashflowSheetMonthsInternal(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        String targetRevision,
        NavigableMap<String, List<CashflowSheetLabApplyRequest.Cell>> cellsByMonth,
        boolean replaceAllActualSources,
        boolean allowLockedWeeks
    ) {
        requireValidatedCashflowWriteScope(tenantId, projectId);
        requireCashflowMonthsOpen(tenantId, projectId, cellsByMonth.navigableKeySet());

        Map<String, Map<String, Map<String, Object>>> targetDocsByMonth = new TreeMap<>();
        cellsByMonth.keySet().forEach(yearMonth -> targetDocsByMonth.put(yearMonth, new TreeMap<>()));
        DocumentReference[] targetWeekRefs = cellsByMonth.keySet().stream()
            .flatMap(yearMonth -> java.util.stream.IntStream
                .rangeClosed(1, CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT)
                .mapToObj(weekNo -> cashflowWeekRef(tenantId, cashflowWeekId(projectId, yearMonth, weekNo))))
            .toArray(DocumentReference[]::new);
        for (DocumentSnapshot snap : getAll(targetWeekRefs)) {
            if (!snap.exists()) continue;
            Map<String, Object> document = data(snap);
            WeekDocParts parts = parseCashflowWeekId(projectId, snap.getId());
            Map<String, Map<String, Object>> targetMonthDocs = targetDocsByMonth.get(parts.yearMonth());
            if (targetMonthDocs == null) throw malformedCashflowMonth();
            requireCanonicalCashflowMonthDocument(
                projectId,
                parts.yearMonth(),
                parts.weekNo(),
                snap.getId(),
                document
            );
            targetMonthDocs.put(snap.getId(), document);
        }

        QuerySnapshot existingSnapshot = query(cashflowWeeks(tenantId).whereEqualTo("projectId", projectId));
        Map<String, Map<String, Object>> allProjectWeeks = new LinkedHashMap<>();
        for (DocumentSnapshot doc : existingSnapshot.getDocuments()) {
            allProjectWeeks.put(doc.getId(), data(doc));
        }
        for (Map.Entry<String, Map<String, Object>> entry : allProjectWeeks.entrySet()) {
            Map<String, Object> document = entry.getValue();
            String storedYearMonth = text(document.get("yearMonth"), "");
            WeekDocParts parts = parseCashflowWeekId(projectId, entry.getKey());
            Map<String, Map<String, Object>> targetMonthDocs = targetDocsByMonth.get(parts.yearMonth());
            if (targetMonthDocs == null && !targetDocsByMonth.containsKey(storedYearMonth)) {
                continue;
            }
            String yearMonth = targetMonthDocs == null ? storedYearMonth : parts.yearMonth();
            requireCanonicalCashflowMonthDocument(
                projectId,
                yearMonth,
                parts.weekNo(),
                entry.getKey(),
                document
            );
            targetDocsByMonth.get(yearMonth).put(entry.getKey(), document);
        }
        targetDocsByMonth.values().forEach(allProjectWeeks::putAll);
        String currentRevision = computeCashflowTargetRevision(allProjectWeeks.values());
        if (!currentRevision.equals(targetRevision)) {
            throw new WeeklyExpenseConflictException("Cashflow target revision changed. Refresh the sheet before applying.");
        }
        DocumentReference mirrorRef = db.document(
            "orgs/" + tenantId + "/cashflow_sheet_mirrors/" + projectId
        );
        DocumentSnapshot mirrorSnapshot = get(mirrorRef);
        boolean mirrorTracksTargetRevision = mirrorSnapshot.exists()
            && targetRevision.equals(text(data(mirrorSnapshot).get("targetRevisionAtFetch"), ""));

        Instant now = clock.instant();
        Map<String, Map<String, Object>> replacements = new LinkedHashMap<>();
        Comparator<WeeklyExpenseProjectionEntity> projectionOrder = Comparator
            .comparingInt(WeeklyExpenseProjectionEntity::getWeekNo)
            .thenComparing(WeeklyExpenseProjectionEntity::getCashflowLine);
        Comparator<WeeklyExpenseActualEntity> actualOrder = Comparator
            .comparingInt(WeeklyExpenseActualEntity::getWeekNo)
            .thenComparing(WeeklyExpenseActualEntity::getCashflowLine);
        List<CashflowSheetBatchMonthReplacement> monthResults = new ArrayList<>();

        for (Map.Entry<String, List<CashflowSheetLabApplyRequest.Cell>> monthEntry : cellsByMonth.entrySet()) {
            String yearMonth = monthEntry.getKey();
            List<CashflowSheetLabApplyRequest.Cell> cells = monthEntry.getValue();
            Map<String, Map<String, Object>> targetMonthDocs = targetDocsByMonth.get(yearMonth);
            Map<Integer, List<CashflowSheetLabApplyRequest.Cell>> cellsByWeek = new TreeMap<>();
            for (CashflowSheetLabApplyRequest.Cell cell : cells) {
                cellsByWeek.computeIfAbsent(cell.weekNo(), ignored -> new ArrayList<>()).add(cell);
            }
            for (Integer weekNo : cellsByWeek.keySet()) {
                String docId = cashflowWeekId(projectId, yearMonth, weekNo);
                targetMonthDocs.putIfAbsent(docId, baseCashflowWeekDoc(tenantId, projectId, docId));
            }

            Map<String, Map<String, Object>> monthReplacements = new TreeMap<>();
            for (Map.Entry<String, Map<String, Object>> entry : targetMonthDocs.entrySet()) {
                String docId = entry.getKey();
                Map<String, Object> existing = entry.getValue();
                WeekDocParts parts = parseCashflowWeekId(projectId, docId);
                int weekNo = intValue(existing.get("weekNo"), parts.weekNo());
                List<CashflowSheetLabApplyRequest.Cell> weekCells = cellsByWeek.getOrDefault(weekNo, List.of());

                Map<String, BigDecimal> projectionAmounts = new LinkedHashMap<>();
                List<SaveDraftResponse.ActualDelta> actualDeltas = new ArrayList<>();
                for (CashflowSheetLabApplyRequest.Cell cell : weekCells) {
                    if (!"VALUE".equals(cell.cellState())) continue;
                    if ("projection".equals(cell.mode())) {
                        projectionAmounts.put(cell.cashflowLine(), amount(cell.amount()));
                    } else {
                        actualDeltas.add(new SaveDraftResponse.ActualDelta(
                            yearMonth,
                            weekNo,
                            cell.cashflowLine(),
                            amount(cell.amount())
                        ));
                    }
                }

                Map<String, Object> replacement = new LinkedHashMap<>(existing);
                replacement.put("id", docId);
                replacement.put("tenantId", tenantId);
                replacement.put("projectId", projectId);
                replacement.put("yearMonth", yearMonth);
                replacement.put("weekNo", weekNo);
                replacement.put("projection", FirestoreCashflowWeekActualMerge.numberMap(projectionAmounts));
                replacement.put("projectionTotals", FirestoreCashflowWeekActualMerge.cashflowTotals(projectionAmounts));
                replacement.put("projectionUpdated", true);
                replacement.put("projectionUpdatedAt", now.toString());
                replacement.putAll(FirestoreCashflowWeekActualMerge.buildPatch(
                    tenantId,
                    projectId,
                    sourceSheetKey,
                    existing,
                    actualDeltas,
                    now,
                    replaceAllActualSources
                ));
                monthReplacements.put(docId, replacement);
                replacements.put(docId, replacement);
            }

            List<WeeklyExpenseProjectionEntity> projection = new ArrayList<>();
            List<WeeklyExpenseActualEntity> actual = new ArrayList<>();
            for (CashflowSheetLabApplyRequest.Cell cell : cells) {
                if (!"VALUE".equals(cell.cellState())) continue;
                if ("projection".equals(cell.mode())) {
                    WeeklyExpenseProjectionEntity line = new WeeklyExpenseProjectionEntity(
                        tenantId, projectId, yearMonth, cell.weekNo(), cell.cashflowLine()
                    );
                    line.setAmount(cell.amount());
                    projection.add(line);
                } else {
                    WeeklyExpenseActualEntity line = new WeeklyExpenseActualEntity(
                        tenantId, projectId, sourceSheetKey, yearMonth, cell.weekNo(), cell.cashflowLine()
                    );
                    line.setAmount(cell.amount());
                    actual.add(line);
                }
            }
            projection.sort(projectionOrder);
            actual.sort(actualOrder);
            List<CashflowMonthWeekSnapshot> canonicalWeeks = monthReplacements.values().stream()
                .sorted(Comparator.comparingInt(document -> intValue(document.get("weekNo"), 0)))
                .map(document -> new CashflowMonthWeekSnapshot(
                    intValue(document.get("weekNo"), 0),
                    nestedMap(document.get("projection")),
                    nestedMap(document.get("actual"))
                ))
                .toList();
            monthResults.add(new CashflowSheetBatchMonthReplacement(
                yearMonth,
                List.copyOf(projection),
                List.copyOf(actual),
                canonicalWeeks
            ));
        }

        List<String> replacementKeysToWrite = replacements.keySet().stream().toList();
        if (!allowLockedWeeks) {
            replacementKeysToWrite = replacements.entrySet().stream()
                .filter(entry -> !allProjectWeeks.containsKey(entry.getKey())
                    || cashflowWeekFinancialContentChanged(
                        allProjectWeeks.get(entry.getKey()),
                        entry.getValue()
                    ))
                .map(Map.Entry::getKey)
                .toList();
            List<CashflowWeekScope> changedWeeks = replacementKeysToWrite.stream()
                .map(key -> {
                    WeekDocParts parts = parseCashflowWeekId(projectId, key);
                    return new CashflowWeekScope(parts.yearMonth(), parts.weekNo());
                })
                .toList();
            requireCashflowWeeksOpen(tenantId, projectId, changedWeeks);
        }
        for (String replacementKey : replacementKeysToWrite) {
            replaceDocument(cashflowWeekRef(tenantId, replacementKey), replacements.get(replacementKey));
        }

        Map<String, Map<String, Object>> resultingWeeks = new LinkedHashMap<>(allProjectWeeks);
        resultingWeeks.putAll(replacements);
        String resultingTargetRevision = computeCashflowTargetRevision(resultingWeeks.values());
        if (mirrorTracksTargetRevision) {
            set(mirrorRef, Map.of(
                "targetRevisionAtFetch", resultingTargetRevision,
                "targetRevisionUpdatedAt", now.toString(),
                "targetRevisionUpdateSource", "JVM_CANONICAL_APPLY"
            ));
        }
        return new CashflowSheetBatchReplacement(
            List.copyOf(monthResults),
            resultingTargetRevision
        );
    }

    private static boolean cashflowWeekFinancialContentChanged(
        Map<String, Object> existing,
        Map<String, Object> replacement
    ) {
        return !revisionAmounts(existing.get("projection")).equals(revisionAmounts(replacement.get("projection")))
            || !revisionAmounts(existing.get("actual")).equals(revisionAmounts(replacement.get("actual")))
            || !revisionAmountSources(existing.get("weeklyExpenseActualBySheet"))
                .equals(revisionAmountSources(replacement.get("weeklyExpenseActualBySheet")));
    }

    @Override
    public CashflowSheetAnnualReplacement replaceCashflowSheetYearTotal(
        String tenantId,
        String projectId,
        String sourceSheetKey,
        CashflowSheetAnnualApplyRequest request
    ) {
        requireValidatedCashflowWriteScope(tenantId, projectId);
        List<CashflowSheetAnnualApplyRequest.Cell> cells = CashflowSheetAnnualApplyRequest
            .requireCompleteYear(request.cells());
        DocumentReference ref = cashflowYearTotalRef(tenantId, projectId, request.year());
        DocumentSnapshot snapshot = get(ref);
        Map<String, Object> current = snapshot.exists() ? data(snapshot) : Map.of();
        long currentRevision = longValue(current.get("revision"), 0);
        if (currentRevision != request.expectedRevision()) {
            throw new WeeklyExpenseConflictException("Cashflow annual total revision changed. Reload before applying.");
        }

        Map<String, BigDecimal> projection = new TreeMap<>();
        Map<String, BigDecimal> actual = new TreeMap<>();
        Map<String, String> projectionStates = new TreeMap<>();
        Map<String, String> actualStates = new TreeMap<>();
        List<Map<String, Object>> sourceCells = new ArrayList<>();
        for (CashflowSheetAnnualApplyRequest.Cell cell : cells) {
            Map<String, BigDecimal> amounts = "projection".equals(cell.mode()) ? projection : actual;
            Map<String, String> states = "projection".equals(cell.mode()) ? projectionStates : actualStates;
            states.put(cell.cashflowLine(), cell.cellState());
            if ("VALUE".equals(cell.cellState())) amounts.put(cell.cashflowLine(), cell.amount());
            Map<String, Object> sourceCell = new LinkedHashMap<>();
            sourceCell.put("mode", cell.mode());
            sourceCell.put("cashflowLine", cell.cashflowLine());
            sourceCell.put("cellState", cell.cellState());
            if (cell.amount() != null) sourceCell.put("amount", cell.amount().longValueExact());
            if (cell.sourceCell() != null && !cell.sourceCell().isBlank()) sourceCell.put("sourceCell", cell.sourceCell());
            if (cell.sourceLabel() != null && !cell.sourceLabel().isBlank()) sourceCell.put("sourceLabel", cell.sourceLabel());
            sourceCells.add(sourceCell);
        }

        long revision = Math.addExact(currentRevision, 1);
        Instant now = clock.instant();
        Map<String, Object> document = new LinkedHashMap<>();
        document.put("id", safeDocId(projectId + "\n" + request.year()));
        document.put("tenantId", tenantId);
        document.put("projectId", projectId);
        document.put("year", request.year());
        document.put("sourceSheetKey", sourceSheetKey);
        document.put("sourceRevision", request.sourceRevision());
        document.put("revision", revision);
        document.put("source", "ANNUAL");
        document.put("projection", FirestoreCashflowWeekActualMerge.numberMap(projection));
        document.put("actual", FirestoreCashflowWeekActualMerge.numberMap(actual));
        document.put("projectionStates", projectionStates);
        document.put("actualStates", actualStates);
        document.put("cells", sourceCells);
        document.put("updatedAt", now.toString());
        replaceDocument(ref, document);
        return new CashflowSheetAnnualReplacement(
            revision,
            Map.copyOf(projection),
            Map.copyOf(actual),
            Map.copyOf(projectionStates),
            Map.copyOf(actualStates)
        );
    }

    static String computeCashflowTargetRevision(Collection<Map<String, Object>> documents) {
        List<Map<String, Object>> weeks = new ArrayList<>();
        for (Map<String, Object> document : documents == null ? List.<Map<String, Object>>of() : documents) {
            String yearMonth = textValue(document.get("yearMonth"));
            Object weekValue = document.get("weekNo");
            if (yearMonth.isBlank() || !(weekValue instanceof Number weekNumber)) continue;
            Map<String, Object> week = new TreeMap<>();
            week.put("actual", revisionAmounts(document.get("actual")));
            week.put("adminClosed", revisionBoolean(document.get("adminClosed")));
            week.put("projection", revisionAmounts(document.get("projection")));
            week.put("weekNo", normalizedRevisionNumber(weekNumber));
            week.put("weeklyExpenseActualBySheet", revisionAmountSources(document.get("weeklyExpenseActualBySheet")));
            week.put("yearMonth", yearMonth);
            weeks.add(week);
        }
        weeks.sort(Comparator
            .comparing((Map<String, Object> week) -> String.valueOf(week.get("yearMonth")))
            .thenComparing(week -> new BigDecimal(String.valueOf(week.get("weekNo")))));
        Map<String, Object> root = new TreeMap<>();
        root.put("weeks", weeks);
        try {
            String json = JSON.writeValueAsString(root);
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8));
            return "sha256:" + HexFormat.of().formatHex(digest);
        } catch (JsonProcessingException | NoSuchAlgorithmException error) {
            throw new IllegalStateException("Could not compute cashflow target revision.", error);
        }
    }

    private static Map<String, Object> revisionAmounts(Object value) {
        Map<String, Object> normalized = new TreeMap<>();
        if (!(value instanceof Map<?, ?> amounts)) return normalized;
        for (Map.Entry<?, ?> entry : amounts.entrySet()) {
            if (entry.getValue() instanceof Number number && isFinite(number)) {
                normalized.put(String.valueOf(entry.getKey()), normalizedRevisionNumber(number));
            }
        }
        return normalized;
    }

    private static Map<String, Object> revisionAmountSources(Object value) {
        Map<String, Object> normalized = new TreeMap<>();
        if (!(value instanceof Map<?, ?> sources)) return normalized;
        for (Map.Entry<?, ?> entry : sources.entrySet()) {
            Map<String, Object> amounts = revisionAmounts(entry.getValue());
            if (!amounts.isEmpty()) {
                normalized.put(String.valueOf(entry.getKey()), amounts);
            }
        }
        return normalized;
    }

    private void requireCanonicalCashflowMonthDocument(
        String projectId,
        String yearMonth,
        int expectedWeekNo,
        String docId,
        Map<String, Object> document
    ) {
        if (!projectId.equals(text(document.get("projectId"), ""))
            || !yearMonth.equals(text(document.get("yearMonth"), ""))
            || expectedWeekNo < 1
            || expectedWeekNo > CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT
            || exactInteger(document.get("weekNo")) != expectedWeekNo
            || !docId.equals(cashflowWeekId(projectId, yearMonth, expectedWeekNo))) {
            throw malformedCashflowMonth();
        }
        requireNumericAmountField(document, "projection");
        requireNumericAmountField(document, "actual");
        if (document.containsKey("weeklyExpenseActualBySheet")) {
            Object value = document.get("weeklyExpenseActualBySheet");
            if (!(value instanceof Map<?, ?> sources)) throw malformedCashflowMonth();
            for (Object amounts : sources.values()) {
                requireNumericAmounts(amounts);
            }
        }
    }

    private void requireNumericAmountField(Map<String, Object> document, String field) {
        if (document.containsKey(field)) requireNumericAmounts(document.get(field));
    }

    private void requireNumericAmounts(Object value) {
        if (!(value instanceof Map<?, ?> amounts)) throw malformedCashflowMonth();
        for (Object amount : amounts.values()) {
            if (!(amount instanceof Number number) || !isFinite(number)) {
                throw malformedCashflowMonth();
            }
            try {
                new BigDecimal(number.toString()).longValueExact();
            } catch (ArithmeticException | NumberFormatException error) {
                throw malformedCashflowMonth();
            }
        }
    }

    private int exactInteger(Object value) {
        if (!(value instanceof Number number) || !isFinite(number)) return 0;
        try {
            return new BigDecimal(number.toString()).intValueExact();
        } catch (ArithmeticException | NumberFormatException error) {
            return 0;
        }
    }

    private WeeklyExpenseConflictException malformedCashflowMonth() {
        return new WeeklyExpenseConflictException(
            "Cashflow month contains malformed or non-canonical week documents; "
                + "migration is required before applying."
        );
    }

    private static Object normalizedRevisionNumber(Number number) {
        BigDecimal value = number instanceof BigDecimal decimal
            ? decimal
            : new BigDecimal(number.toString());
        value = value.signum() == 0 ? BigDecimal.ZERO : value.stripTrailingZeros();
        try {
            return value.longValueExact();
        } catch (ArithmeticException ignored) {
            return value;
        }
    }

    private static boolean isFinite(Number number) {
        if (number instanceof Double value) return Double.isFinite(value);
        if (number instanceof Float value) return Float.isFinite(value);
        return true;
    }

    private static boolean revisionBoolean(Object value) {
        if (value instanceof Boolean bool) return bool;
        return value != null && !String.valueOf(value).isBlank();
    }

    private static String textValue(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String requireStoredCashflowWriter(
        Map<String, Object> member,
        TrustedActorContext actor,
        String projectId,
        boolean designatedExecutiveApprover
    ) {
        String memberUid = text(member.get("uid"), "");
        String storedRole = text(member.get("role"), "").toLowerCase(Locale.ROOT);
        if (member.isEmpty()
            || !"ACTIVE".equals(text(member.get("status"), "").toUpperCase(Locale.ROOT))
            || (!memberUid.isBlank() && !actor.id().equals(memberUid))
            || !CASHFLOW_WRITE_ROLES.contains(storedRole)
            || (!CASHFLOW_CROSS_PROJECT_ROLES.contains(storedRole)
                && !memberProjectIds(member).contains(projectId)
                && !designatedExecutiveApprover)) {
            throw leaseError(403, "cashflow_project_write_forbidden", "Stored project assignment is required for cashflow writes.");
        }
        return storedRole;
    }

    private Set<String> memberProjectIds(Map<String, Object> member) {
        java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>();
        addProjectId(ids, member.get("projectId"));
        addProjectIds(ids, member.get("projectIds"));
        Object portalProfile = member.get("portalProfile");
        if (portalProfile instanceof Map<?, ?> profile) {
            addProjectId(ids, profile.get("projectId"));
            addProjectIds(ids, profile.get("projectIds"));
        }
        return ids;
    }

    private void addProjectId(Set<String> ids, Object value) {
        String projectId = text(value, "");
        if (!projectId.isBlank()) ids.add(projectId);
    }

    private void addProjectIds(Set<String> ids, Object value) {
        if (!(value instanceof Iterable<?> iterable)) return;
        for (Object item : iterable) addProjectId(ids, item);
    }

    private String cashflowLeasePath(String tenantId, String projectId) {
        try {
            String resource = JSON.writeValueAsString(List.of("cashflow", projectId));
            return "orgs/" + tenantId + "/editLeases/v1_" + safeDocId(resource);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Invalid cashflow project id.", error);
        }
    }

    private String monthlyClosePath(String tenantId, String projectId, String yearMonth) {
        return "orgs/" + tenantId + "/monthly_closes/" + projectId + "-" + yearMonth;
    }

    private String cashflowWeeklyUpdateCompletionPath(String tenantId, String documentId) {
        return "orgs/" + tenantId + "/cashflow_weekly_update_completions/" + documentId;
    }

    private String cashflowWeeklyUpdateCompletionVersionPath(String tenantId, String versionId) {
        return "orgs/" + tenantId + "/cashflow_weekly_update_completion_versions/" + versionId;
    }

    private String monthlyCloseVersionPath(String tenantId, String versionId) {
        return "orgs/" + tenantId + "/monthly_close_versions/" + versionId;
    }

    private String monthStateKey(String tenantId, String projectId, String yearMonth) {
        return tenantId + "\n" + projectId + "\n" + yearMonth;
    }

    private void requireCachedCashflowMonthOpen(String tenantId, String projectId, String yearMonth) {
        requireYearMonth(yearMonth);
        Map<String, String> states = currentCashflowMonthStates.get();
        String key = monthStateKey(tenantId, projectId, yearMonth);
        String status = states == null ? null : states.get(key);
        if (status == null) {
            throw leaseError(
                503,
                "cashflow_month_guard_missing",
                "Cashflow month state must be validated before canonical writes."
            );
        }
        if ("CLOSED".equals(status) && isAuthorizedCashflowMonthAmendment(key)) return;
        requireMutableMonthStatus(status);
    }

    private boolean isAuthorizedCashflowMonthAmendment(String monthStateKey) {
        Map<String, CashflowClosedMonthAmendment> amendments = currentCashflowMonthAmendments.get();
        return amendments != null && amendments.containsKey(monthStateKey);
    }

    private String canonicalMonthStatus(
        Map<String, Object> close,
        String tenantId,
        String projectId,
        String yearMonth
    ) {
        if (!CASHFLOW_MONTH_CLOSE_CONTRACT_VERSION.equals(text(close.get("contractVersion"), ""))
            || !tenantId.equals(text(close.get("tenantId"), ""))
            || !projectId.equals(text(close.get("projectId"), ""))
            || !yearMonth.equals(text(close.get("yearMonth"), ""))) {
            throw new WeeklyExpenseConflictException(
                "Cashflow month close document is not canonical; Stage overwrite migration is required."
            );
        }
        canonicalMonthCounter(close, "revision");
        canonicalMonthCounter(close, "reopenCount");
        String status = text(close.get("status"), "");
        if (Set.of("OPEN", "CLOSED", "REOPEN_REQUESTED").contains(status)) return status;
        throw new WeeklyExpenseConflictException(
            "Cashflow month close status is not canonical; Stage overwrite migration is required."
        );
    }

    private void requireMutableMonthStatus(String status) {
        if ("OPEN".equals(status)) return;
        if ("CLOSED".equals(status) || "REOPEN_REQUESTED".equals(status)) {
            throw new WeeklyExpenseConflictException("Cashflow month is closed and cannot be changed.");
        }
        throw new WeeklyExpenseConflictException(
            "Cashflow month close status is not canonical; Stage overwrite migration is required."
        );
    }

    private long cashflowVarianceRevision(Map<String, Object> week) {
        Object value = week.get("varianceRevision");
        if (value == null) return 0;
        if (!(value instanceof Number number) || !isFinite(number)) {
            throw leaseError(409, "cashflow_metadata_version_conflict", "Cashflow variance revision is not canonical.");
        }
        try {
            long revision = new BigDecimal(number.toString()).longValueExact();
            if (revision < 0 || revision > MAX_SAFE_INTEGER) throw new ArithmeticException();
            return revision;
        } catch (ArithmeticException | NumberFormatException error) {
            throw leaseError(409, "cashflow_metadata_version_conflict", "Cashflow variance revision is not canonical.");
        }
    }

    private void requireCashflowVarianceMonthOpen(String tenantId, String projectId, String yearMonth) {
        try {
            requireCashflowMonthsOpen(tenantId, projectId, List.of(yearMonth));
        } catch (WeeklyExpenseConflictException error) {
            if ("Cashflow month is closed and cannot be changed.".equals(error.getMessage())) {
                throw leaseError(409, "cashflow_month_closed", error.getMessage());
            }
            throw leaseError(
                409,
                "cashflow_month_close_migration_required",
                "Cashflow month close data requires migration before it can be changed."
            );
        }
    }

    private Map<String, Object> cashflowVarianceFlag(Object value) {
        if (value == null) return Map.of();
        if (!(value instanceof Map<?, ?> map)) {
            throw leaseError(409, "cashflow_variance_state_conflict", "Cashflow variance state is not canonical.");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                throw leaseError(409, "cashflow_variance_state_conflict", "Cashflow variance state is not canonical.");
            }
            result.put(String.valueOf(entry.getKey()), entry.getValue());
        }
        return result;
    }

    private List<Map<String, Object>> cashflowVarianceHistory(Object value) {
        if (value == null) return List.of();
        if (!(value instanceof List<?> list)) {
            throw leaseError(409, "cashflow_variance_state_conflict", "Cashflow variance history is not canonical.");
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : list) {
            Map<String, Object> event = cashflowVarianceFlag(item);
            if (event.isEmpty()) {
                throw leaseError(409, "cashflow_variance_state_conflict", "Cashflow variance history is not canonical.");
            }
            result.add(event);
        }
        return result;
    }

    private String cashflowActorDisplayName(TrustedActorContext actor) {
        Map<String, Object> member = cachedDocumentIfPresent(
            db.document("orgs/" + actor.tenantId() + "/members/" + actor.id())
        ).orElse(Map.of());
        for (String field : List.of("name", "displayName", "fullName")) {
            String name = text(member.get(field), "");
            if (!name.isBlank()) return name;
        }
        return actor.name().isBlank() ? actor.id() : actor.name();
    }

    private YearMonth requireYearMonth(String value) {
        try {
            YearMonth yearMonth = YearMonth.parse(value == null ? "" : value.trim());
            if (yearMonth.getYear() < 2000 || yearMonth.getYear() > 2099) throw new IllegalArgumentException();
            return yearMonth;
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("yearMonth must be YYYY-MM.");
        }
    }

    private ValidatedCloseSource requirePinnedCloseSource(
        TrustedActorContext actor,
        String projectId,
        CloseCashflowMonthRequest request
    ) {
        DocumentSnapshot mirrorSnapshot = get(db.document(
            "orgs/" + actor.tenantId() + "/cashflow_sheet_mirrors/" + projectId
        ));
        if (!mirrorSnapshot.exists()) {
            throw new WeeklyExpenseConflictException("A fresh pinned cashflow sheet snapshot is required before closing.");
        }
        Map<String, Object> mirror = data(mirrorSnapshot);
        if (!"FRESH".equals(text(mirror.get("status"), ""))
            || (!text(mirror.get("projectId"), "").isBlank()
                && !projectId.equals(text(mirror.get("projectId"), "")))
            || !request.sourceRevision().equals(text(mirror.get("sourceRevision"), ""))
            || !request.targetRevision().equals(text(mirror.get("targetRevisionAtFetch"), ""))
            || !containsText(mirror.get("yearMonths"), request.yearMonth())) {
            throw new WeeklyExpenseConflictException(
                "The pinned cashflow sheet snapshot changed or does not contain this month. Refresh it before closing."
            );
        }
        String capturedAt = text(mirror.get("capturedAt"), "");
        if (capturedAt.isBlank()) {
            throw new WeeklyExpenseConflictException("Pinned cashflow source time is missing. Refresh it before closing.");
        }
        requireMatchingPinnedCells(mirror.get("cells"), request);
        Map<String, Object> sheetFacts = nestedMap(mirror.get("sheetFacts"));
        requireCloseablePinnedSheetFacts(sheetFacts, request);
        return new ValidatedCloseSource(capturedAt, sheetFacts);
    }

    private void requireMatchingPinnedCells(Object value, CloseCashflowMonthRequest request) {
        if (!(value instanceof Iterable<?> rows)) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow cells are missing. Refresh the sheet before closing."
            );
        }
        Map<String, Map<String, Object>> sourceByKey = new LinkedHashMap<>();
        for (Object item : rows) {
            Map<String, Object> source = nestedMap(item);
            if (!request.yearMonth().equals(text(source.get("yearMonth"), ""))) continue;
            String mode = text(source.get("mode"), "").toLowerCase(Locale.ROOT);
            int weekNo = intValue(source.get("weekNo"), 0);
            String line = text(source.get("lineId"), text(source.get("cashflowLine"), ""));
            String key = mode + ":" + weekNo + ":" + line;
            if (sourceByKey.putIfAbsent(key, source) != null) {
                throw new WeeklyExpenseConflictException("Pinned cashflow cells contain duplicates.");
            }
        }
        List<CashflowSheetLabApplyRequest.Cell> requested = CashflowSheetLabApplyRequest.requireCompleteMonth(request.cells());
        if (sourceByKey.size() != CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow month is incomplete. Refresh the sheet before closing."
            );
        }
        for (CashflowSheetLabApplyRequest.Cell cell : requested) {
            String key = cell.mode() + ":" + cell.weekNo() + ":" + cell.cashflowLine();
            Map<String, Object> source = sourceByKey.get(key);
            String sourceState = text(source == null ? null : source.get("state"), "").toUpperCase(Locale.ROOT);
            if (source == null
                || !cell.cellState().equals(sourceState)
                || ("VALUE".equals(cell.cellState()) && !sameOptionalAmount(cell.amount(), source.get("amount")))
                || !text(cell.sourceCell(), "").equals(text(source.get("sourceCell"), ""))
                || !text(cell.sourceLabel(), "").equals(text(source.get("sourceLabel"), ""))) {
                throw new WeeklyExpenseConflictException(
                    "Cashflow month close values do not match the pinned sheet. Refresh and review the sheet again."
                );
            }
        }
    }

    private void requireCloseablePinnedSheetFacts(
        Map<String, Object> sheetFacts,
        CloseCashflowMonthRequest request
    ) {
        if (sheetFacts.isEmpty()) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow sheet validation is missing. Refresh the sheet before closing."
            );
        }
        Object issues = sheetFacts.get("issues");
        if (issues instanceof Iterable<?> values && values.iterator().hasNext()) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow sheet contains invalid date or amount values."
            );
        }
        Map<String, Object> controls = nestedMap(sheetFacts.get("controlTotals"));
        if (!bool(nestedMap(controls.get("deposit")).get("matches"))) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow sheet deposit control total does not match the 60-week sum."
            );
        }
        requireMatchingControlRows(controls.get("projection"), "Projection");
        requireMatchingControlRows(controls.get("actual"), "Actual");
        requireMatchingDepositSource(sheetFacts.get("depositScheduleRows"), request);
    }

    private void requireMatchingControlRows(Object value, String mode) {
        if (!(value instanceof List<?> rows) || rows.size() != 19) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow sheet " + mode + " control totals are incomplete. Refresh the sheet before closing."
            );
        }
        for (Object row : rows) {
            if (!bool(nestedMap(row).get("matches"))) {
                throw new WeeklyExpenseConflictException(
                    "Pinned cashflow sheet " + mode + " control total does not match the 60-week sum."
                );
            }
        }
    }

    private void requireMatchingDepositSource(Object value, CloseCashflowMonthRequest request) {
        if (!(value instanceof Iterable<?> rows)) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow sheet deposit schedule is missing. Refresh the sheet before closing."
            );
        }
        Map<Integer, Map<String, Object>> sourceByWeek = new LinkedHashMap<>();
        for (Object item : rows) {
            Map<String, Object> row = nestedMap(item);
            if (!request.yearMonth().equals(text(row.get("yearMonth"), ""))) continue;
            int weekNo = intValue(row.get("weekNo"), 0);
            if (weekNo < 1 || weekNo > 5 || sourceByWeek.putIfAbsent(weekNo, row) != null) {
                throw new WeeklyExpenseConflictException("Pinned cashflow sheet deposit schedule is invalid.");
            }
        }
        if (sourceByWeek.size() != 5) {
            throw new WeeklyExpenseConflictException(
                "Pinned cashflow sheet deposit schedule must contain weeks 1 through 5."
            );
        }
        for (CloseCashflowMonthRequest.DepositScheduleRow row : request.depositScheduleRows()) {
            Map<String, Object> source = sourceByWeek.get(row.weekNo());
            if (source == null
                || !row.taxInvoiceIssuedDate().equals(text(source.get("taxInvoiceIssuedDate"), ""))
                || !row.expectedDepositDate().equals(text(source.get("expectedDepositDate"), ""))
                || !sameOptionalAmount(row.expectedDepositAmount(), source.get("expectedDepositAmount"))) {
                throw new WeeklyExpenseConflictException(
                    "Cashflow month close deposit schedule does not match the pinned sheet source."
                );
            }
        }
    }

    private boolean sameOptionalAmount(BigDecimal expected, Object value) {
        if (expected == null || value == null) return expected == null && value == null;
        try {
            return expected.compareTo(new BigDecimal(String.valueOf(value))) == 0;
        } catch (NumberFormatException error) {
            return false;
        }
    }

    private Map<String, Object> closeInputMap(CloseCashflowMonthRequest request) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("yearMonth", request.yearMonth());
        input.put("sourceRevision", request.sourceRevision());
        input.put("targetRevision", request.targetRevision());
        input.put("depositScheduleRows", request.depositScheduleRows());
        input.put("cells", request.cells());
        input.put("confirmations", request.confirmations());
        input.put("managementChecks", request.managementChecks());
        input.put("managementConfirmations", request.managementConfirmations());
        input.put("deadlineSummary", request.deadlineSummary());
        return JSON.convertValue(input, Map.class);
    }

    private Map<String, Object> canonicalCloseInput(Map<String, Object> raw) {
        try {
            Map<String, Object> selected = new LinkedHashMap<>();
            for (String field : List.of(
                "yearMonth",
                "sourceRevision",
                "targetRevision",
                "depositScheduleRows",
                "cells",
                "confirmations",
                "managementChecks",
                "managementConfirmations",
                "deadlineSummary"
            )) {
                selected.put(field, raw.get(field));
            }
            StoredCashflowMonthCloseInput input = JSON.convertValue(selected, StoredCashflowMonthCloseInput.class);
            requireYearMonth(input.yearMonth());
            if (!text(input.sourceRevision(), "").matches("sha256:[a-f0-9]{64}")
                || !text(input.targetRevision(), "").matches("sha256:[a-f0-9]{64}")) {
                throw new IllegalArgumentException("Cashflow month close revisions are invalid.");
            }
            List<CashflowSheetLabApplyRequest.Cell> cells = CashflowSheetLabApplyRequest
                .requireCompleteMonth(input.cells());
            List<CloseCashflowMonthRequest.DepositScheduleRow> deposits = CloseCashflowMonthRequest
                .requireCompleteDepositSchedule(input.depositScheduleRows());
            List<CloseCashflowMonthRequest.Confirmation> confirmations = CloseCashflowMonthRequest
                .requireCompleteConfirmations(input.confirmations());
            List<CloseCashflowMonthRequest.ManagementCheck> managementChecks = CloseCashflowMonthRequest
                .requireCompleteManagementChecks(input.managementChecks());
            List<CloseCashflowMonthRequest.ManagementConfirmation> managementConfirmations = CloseCashflowMonthRequest
                .requireCompleteManagementConfirmations(input.managementConfirmations());
            requireConfirmationStatesMatchCells(cells, confirmations);

            Map<String, Object> canonical = new LinkedHashMap<>();
            canonical.put("yearMonth", input.yearMonth());
            canonical.put("sourceRevision", input.sourceRevision());
            canonical.put("targetRevision", input.targetRevision());
            canonical.put("depositScheduleRows", deposits);
            canonical.put("cells", cells);
            canonical.put("confirmations", confirmations);
            canonical.put("managementChecks", managementChecks);
            canonical.put("managementConfirmations", managementConfirmations);
            canonical.put("deadlineSummary", input.deadlineSummary());
            return JSON.convertValue(canonical, Map.class);
        } catch (WeeklyExpenseConflictException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new WeeklyExpenseConflictException(
                "The private cashflow draft contains an invalid month close contract. Save and reload before closing."
            );
        }
    }

    private boolean containsText(Object value, String expected) {
        if (!(value instanceof Iterable<?> values)) return false;
        for (Object item : values) {
            if (expected.equals(String.valueOf(item))) return true;
        }
        return false;
    }

    private String privateDraftPath(String tenantId, String projectId, String actorId) {
        try {
            String resource = JSON.writeValueAsString(List.of("cashflow", projectId, actorId));
            return "orgs/" + tenantId + "/privateEditDrafts/v1_" + safeDocId(resource);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Invalid cashflow private draft key.", error);
        }
    }

    private void requireConfirmationStatesMatchCells(
        List<CashflowSheetLabApplyRequest.Cell> cells,
        List<CloseCashflowMonthRequest.Confirmation> confirmations
    ) {
        Map<String, CloseCashflowMonthRequest.Confirmation> byKey = new LinkedHashMap<>();
        for (CloseCashflowMonthRequest.Confirmation confirmation : confirmations) {
            byKey.put(
                confirmation.mode() + ":" + confirmation.weekNo() + ":" + confirmation.cashflowLine(),
                confirmation
            );
        }
        for (CashflowSheetLabApplyRequest.Cell cell : cells) {
            String key = cell.mode() + ":" + cell.weekNo() + ":" + cell.cashflowLine();
            CloseCashflowMonthRequest.Confirmation confirmation = byKey.get(key);
            String requiredDecision = "VALUE".equals(cell.cellState()) ? "CONFIRMED" : "NOT_APPLICABLE";
            if (confirmation == null || !requiredDecision.equals(confirmation.decision())) {
                throw new IllegalArgumentException(
                    "Each cashflow value must be CONFIRMED and each empty cell must be explicitly NOT_APPLICABLE."
                );
            }
        }
    }

    private List<Map<String, Object>> readProjectMonthCloses(String tenantId, String projectId) {
        QuerySnapshot snapshot = query(db.collection("orgs/" + tenantId + "/monthly_closes")
            .whereEqualTo("projectId", projectId));
        List<Map<String, Object>> closes = new ArrayList<>();
        for (DocumentSnapshot document : snapshot.getDocuments()) {
            Map<String, Object> close = data(document);
            String yearMonth = text(close.get("yearMonth"), "");
            requireYearMonth(yearMonth);
            canonicalMonthStatus(close, tenantId, projectId, yearMonth);
            closes.add(close);
        }
        return closes;
    }

    private long projectWarningCount(List<Map<String, Object>> projectCloses) {
        long count = 0;
        for (Map<String, Object> close : projectCloses == null ? List.<Map<String, Object>>of() : projectCloses) {
            count = addMonthCounters(count, canonicalMonthCounter(close, "reopenCount"));
            count = addMonthCounters(count, optionalMonthCounter(close, "postDeadlineAmendmentWarningCount"));
        }
        return count;
    }

    private void requireExpectedMonthRevision(Map<String, Object> current, long expectedRevision) {
        if (canonicalMonthCounter(current, "revision") != expectedRevision) {
            throw new WeeklyExpenseConflictException("Cashflow month close revision changed. Reload and retry.");
        }
    }

    private long canonicalMonthCounter(Map<String, Object> close, String field) {
        Object value = close.get(field);
        if (!(value instanceof Number number) || !isFinite(number)) throw malformedMonthCloseCounter();
        try {
            long counter = new BigDecimal(number.toString()).longValueExact();
            if (counter < 0) throw malformedMonthCloseCounter();
            return counter;
        } catch (ArithmeticException | NumberFormatException error) {
            throw malformedMonthCloseCounter();
        }
    }

    private long addMonthCounters(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException error) {
            throw new WeeklyExpenseConflictException(
                "Cashflow month close counter exceeds the supported range; migration is required."
            );
        }
    }

    private WeeklyExpenseConflictException malformedMonthCloseCounter() {
        return new WeeklyExpenseConflictException(
            "Cashflow month close counters must be non-negative whole numbers in the supported range; "
                + "Stage overwrite migration is required."
        );
    }

    private Map<String, Object> buildMonthCloseSnapshot(
        TrustedActorContext actor,
        String projectId,
        CloseCashflowMonthRequest request,
        List<CloseCashflowMonthRequest.DepositScheduleRow> depositScheduleRows,
        List<CloseCashflowMonthRequest.Confirmation> confirmations,
        CashflowSheetMonthReplacement replacement,
        ValidatedCloseSource source,
        Instant now,
        LocalDate evaluatedBusinessDate,
        boolean qaDateOverride
    ) {
        Map<String, Map<String, BigDecimal>> projectionByWeek = new LinkedHashMap<>();
        Map<String, Map<String, BigDecimal>> actualByWeek = new LinkedHashMap<>();
        for (CashflowMonthWeekSnapshot week : replacement.weeks()) {
            projectionByWeek.put(String.valueOf(week.weekNo()), decimalMap(week.projection()));
            actualByWeek.put(String.valueOf(week.weekNo()), decimalMap(week.actual()));
        }

        Map<String, BigDecimal> projectionTotal = new LinkedHashMap<>();
        Map<String, BigDecimal> actualTotal = new LinkedHashMap<>();
        List<Map<String, Object>> weeklyTotals = new ArrayList<>();
        for (int weekNo = 1; weekNo <= CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT; weekNo += 1) {
            Map<String, BigDecimal> projection = projectionByWeek.getOrDefault(String.valueOf(weekNo), Map.of());
            Map<String, BigDecimal> actual = actualByWeek.getOrDefault(String.valueOf(weekNo), Map.of());
            projection.forEach((line, value) -> projectionTotal.merge(line, value, BigDecimal::add));
            actual.forEach((line, value) -> actualTotal.merge(line, value, BigDecimal::add));
            Map<String, Object> week = new LinkedHashMap<>();
            week.put("weekNo", weekNo);
            week.put("projection", FirestoreCashflowWeekActualMerge.numberMap(projection));
            week.put("actual", FirestoreCashflowWeekActualMerge.numberMap(actual));
            week.put("projectionTotals", FirestoreCashflowWeekActualMerge.cashflowTotals(projection));
            week.put("actualTotals", FirestoreCashflowWeekActualMerge.cashflowTotals(actual));
            weeklyTotals.add(week);
        }

        List<Map<String, Object>> confirmationSnapshot = confirmations.stream()
            .sorted(Comparator
                .comparingInt(CloseCashflowMonthRequest.Confirmation::weekNo)
                .thenComparing(CloseCashflowMonthRequest.Confirmation::mode)
                .thenComparing(CloseCashflowMonthRequest.Confirmation::cashflowLine))
            .map(confirmation -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("key", confirmation.mode() + ":" + confirmation.weekNo() + ":" + confirmation.cashflowLine());
                item.put("mode", confirmation.mode());
                item.put("weekNo", confirmation.weekNo());
                item.put("cashflowLine", confirmation.cashflowLine());
                item.put("decision", confirmation.decision());
                item.put("confirmedByUid", actor.id());
                item.put("confirmedByName", actor.name());
                item.put("confirmedAt", now.toString());
                return item;
            })
            .toList();
        List<Map<String, Object>> depositSnapshot = depositScheduleRows.stream()
            .sorted(Comparator.comparingInt(CloseCashflowMonthRequest.DepositScheduleRow::weekNo))
            .map(row -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("weekNo", row.weekNo());
                item.put("taxInvoiceIssuedDate", row.taxInvoiceIssuedDate());
                item.put("expectedDepositDate", row.expectedDepositDate());
                item.put("expectedDepositAmount", row.expectedDepositAmount());
                item.put("actualDepositDate", row.actualDepositDate());
                item.put("actualDepositAmount", row.actualDepositAmount());
                item.put("actualSource", row.actualSource());
                item.put("decision", row.decision());
                item.put("confirmedByUid", actor.id());
                item.put("confirmedByName", actor.name());
                item.put("confirmedAt", now.toString());
                return item;
            })
            .toList();
        List<Map<String, Object>> managementConfirmationSnapshot = request.managementConfirmations().stream()
            .map(confirmation -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("checkId", confirmation.checkId());
                item.put("decision", confirmation.decision());
                item.put("confirmedByUid", actor.id());
                item.put("confirmedByName", actor.name());
                item.put("confirmedAt", now.toString());
                return item;
            })
            .toList();

        Map<String, Object> projectDocument = cachedDocumentIfPresent(
            db.document("orgs/" + actor.tenantId() + "/projects/" + projectId)
        ).orElseThrow(() -> leaseError(
            503,
            "cashflow_project_snapshot_missing",
            "Canonical project data is unavailable for the month close snapshot."
        ));
        Map<String, Object> project = new LinkedHashMap<>();
        for (String field : List.of(
            "settlementType", "basis", "accountType", "fundInputMode", "contractAmount",
            "paymentExpectedMonths", "laborTransferPlan"
        )) {
            project.put(field, projectDocument.get(field));
        }

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("version", 1);
        snapshot.put("project", project);
        snapshot.put("sheetFacts", source.sheetFacts());
        snapshot.put("depositScheduleRows", depositSnapshot);
        snapshot.put("confirmations", confirmationSnapshot);
        snapshot.put("managementChecks", JSON.convertValue(request.managementChecks(), List.class));
        snapshot.put("managementConfirmations", managementConfirmationSnapshot);
        snapshot.put("deadlineSummary", JSON.convertValue(request.deadlineSummary(), Map.class));
        snapshot.put("weeklyTotals", weeklyTotals);
        snapshot.put("projectionTotal", FirestoreCashflowWeekActualMerge.cashflowTotals(projectionTotal));
        snapshot.put("actualTotal", FirestoreCashflowWeekActualMerge.cashflowTotals(actualTotal));
        snapshot.put("sourceFingerprint", request.sourceRevision());
        snapshot.put("targetRevision", replacement.resultingTargetRevision());
        snapshot.put("sourceReadAt", source.sourceReadAt());
        snapshot.put("draftRevision", request.expectedDraftRevision());
        snapshot.put("draftInputHash", hashCanonicalJson(canonicalCloseInput(closeInputMap(request))));
        snapshot.put("evaluatedBusinessDate", evaluatedBusinessDate.toString());
        snapshot.put("qaDateOverride", qaDateOverride);
        return snapshot;
    }

    private CashflowBusinessDate cashflowMonthCloseBusinessDate(String tenantId, String projectId) {
        LocalDate runtimeQaDate = null;
        if (cashflowMonthCloseBusinessDate.runtimeOverrideAllowed()) {
            DocumentSnapshot snapshot = get(db.document(
                "orgs/" + tenantId + "/cashflow_month_close_qa_dates/" + projectId
            ));
            Map<String, Object> setting = snapshot.exists() ? data(snapshot) : Map.of();
            if (bool(setting.get("active"))) {
                String qaDateTime = text(setting.get("qaDateTime"), "");
                try {
                    runtimeQaDate = LocalDate.parse(qaDateTime.substring(0, 10));
                } catch (RuntimeException error) {
                    throw new WeeklyExpenseConflictException("Stage cashflow QA date is invalid; reset it before month close.");
                }
            }
        }
        return new CashflowBusinessDate(
            cashflowMonthCloseBusinessDate.currentDate(clock, runtimeQaDate),
            cashflowMonthCloseBusinessDate.qaOverrideActive(runtimeQaDate)
        );
    }

    private record CashflowBusinessDate(LocalDate date, boolean qaOverrideActive) {}

    private String hashCanonicalJson(Map<String, Object> value) {
        try {
            String json = JSON.writeValueAsString(canonicalValue(value));
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8));
            return "sha256:" + HexFormat.of().formatHex(digest);
        } catch (JsonProcessingException | NoSuchAlgorithmException error) {
            throw new IllegalStateException("Could not hash cashflow month close snapshot.", error);
        }
    }

    private Object canonicalValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                sorted.put(String.valueOf(entry.getKey()), canonicalValue(entry.getValue()));
            }
            return sorted;
        }
        if (value instanceof Iterable<?> iterable) {
            List<Object> values = new ArrayList<>();
            for (Object item : iterable) values.add(canonicalValue(item));
            return values;
        }
        if (value instanceof Number number) return normalizedRevisionNumber(number);
        return value;
    }

    private Map<String, Object> merge(Map<String, Object> current, Map<String, Object> patch) {
        Map<String, Object> merged = new LinkedHashMap<>(current == null ? Map.of() : current);
        merged.putAll(patch);
        return merged;
    }

    private CashflowMonthCloseRecord toMonthCloseRecord(
        String tenantId,
        String projectId,
        String yearMonth,
        Map<String, Object> document,
        long warningCount
    ) {
        Map<String, Object> reopenRequest = nestedMap(document.get("reopenRequest"));
        Map<String, Object> reopenDecision = nestedMap(document.get("reopenDecision"));
        String status = document.isEmpty()
            ? "OPEN"
            : canonicalMonthStatus(document, tenantId, projectId, yearMonth);
        YearMonth targetMonth = requireYearMonth(yearMonth);
        LocalDate evaluatedBusinessDate = cashflowMonthCloseBusinessDate(tenantId, projectId).date();
        LocalDate closeDeadline = targetMonth.plusMonths(1).atDay(10);
        boolean closeEligible = "OPEN".equals(status) && targetMonth.isBefore(YearMonth.from(evaluatedBusinessDate));
        return new CashflowMonthCloseRecord(
            projectId,
            yearMonth,
            status,
            document.isEmpty() ? 0 : canonicalMonthCounter(document, "revision"),
            document.isEmpty() ? 0 : canonicalMonthCounter(document, "reopenCount"),
            warningCount,
            document.isEmpty() ? 0 : optionalMonthCounter(document, "amendmentCount"),
            document.isEmpty() ? 0 : optionalMonthCounter(document, "postDeadlineAmendmentWarningCount"),
            text(document.get("lastAmendmentAt"), ""),
            text(document.get("lastAmendmentByUid"), ""),
            text(document.get("lastAmendmentByName"), ""),
            text(document.get("lastAmendmentReason"), ""),
            text(document.get("lastAmendmentDeadline"), ""),
            bool(document.get("lastAmendmentPostDeadline")),
            text(document.get("snapshotHash"), ""),
            text(document.get("previousSnapshotHash"), ""),
            nestedMap(document.get("snapshot")),
            nestedMap(document.get("previousSnapshot")),
            closeEligible,
            evaluatedBusinessDate.toString(),
            closeDeadline.toString(),
            "OPEN".equals(status) ? evaluatedBusinessDate.isAfter(closeDeadline) : bool(document.get("late")),
            text(document.get("closedAt"), ""),
            text(document.get("closedByUid"), ""),
            text(document.get("closedByName"), ""),
            text(reopenRequest.get("reason"), ""),
            text(reopenRequest.get("requestedAt"), ""),
            text(reopenRequest.get("requestedByUid"), ""),
            text(reopenDecision.get("decision"), ""),
            text(reopenDecision.get("reason"), ""),
            text(reopenDecision.get("decidedAt"), ""),
            text(reopenDecision.get("decidedByUid"), "")
        );
    }

    private CashflowWeeklyUpdateCompletionRecord toWeeklyCompletionRecord(
        String projectId,
        String yearMonth,
        int weekNo,
        Map<String, Object> document,
        boolean alreadyCompleted
    ) {
        String completedBy = text(
            document.get("completedByName"),
            text(document.get("completedByEmail"), text(document.get("completedByUid"), ""))
        );
        String reopenedBy = text(
            document.get("reopenedByName"),
            text(document.get("reopenedByUid"), "")
        );
        return new CashflowWeeklyUpdateCompletionRecord(
            projectId,
            yearMonth,
            weekNo,
            text(document.get("completedAt"), ""),
            completedBy,
            alreadyCompleted,
            text(document.get("status"), "OPEN"),
            longValue(document.get("revision"), 0),
            longValue(document.get("reopenCount"), 0),
            text(document.get("snapshotHash"), ""),
            text(document.get("sourceRevision"), ""),
            text(document.get("targetRevision"), ""),
            text(document.get("reopenedAt"), ""),
            reopenedBy,
            text(document.get("reopenReason"), "")
        );
    }

    private void requireWeeklyCompletionIntegrity(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo,
        Map<String, Object> completion,
        boolean compareCurrentLedger
    ) {
        if (!"LOCKED".equals(text(completion.get("status"), ""))) return;
        Map<String, Object> lockedSnapshot = nestedMap(completion.get("snapshot"));
        String snapshotHash = text(completion.get("snapshotHash"), "");
        if (lockedSnapshot.isEmpty() || snapshotHash.isBlank() || !snapshotHash.equals(hashCanonicalJson(lockedSnapshot))) {
            throw new WeeklyExpenseConflictException("Cashflow weekly lock snapshot integrity check failed.");
        }
        if (!compareCurrentLedger) return;
        String weekId = cashflowWeekId(projectId, yearMonth, weekNo);
        DocumentSnapshot currentSnapshot = get(cashflowWeekRef(tenantId, weekId));
        Map<String, Object> current = currentSnapshot.exists()
            ? data(currentSnapshot)
            : baseCashflowWeekDoc(tenantId, projectId, weekId);
        boolean matches = revisionAmounts(current.get("projection"))
            .equals(revisionAmounts(lockedSnapshot.get("projection")))
            && revisionAmounts(current.get("actual"))
                .equals(revisionAmounts(lockedSnapshot.get("actual")))
            && revisionAmountSources(current.get("weeklyExpenseActualBySheet"))
                .equals(revisionAmountSources(lockedSnapshot.get("weeklyExpenseActualBySheet")))
            && revisionBoolean(current.get("adminClosed")) == revisionBoolean(lockedSnapshot.get("adminClosed"));
        if (!matches) {
            throw new WeeklyExpenseConflictException(
                "Cashflow weekly lock no longer matches the canonical ledger. Do not continue settlement."
            );
        }
    }

    private WeeklyExpenseEditLeaseException leaseError(int statusCode, String code, String message) {
        return new WeeklyExpenseEditLeaseException(statusCode, code, message);
    }

    @Override
    public Optional<WeeklyExpenseIdempotencyEntity> findIdempotency(
        String tenantId,
        String projectId,
        String commandName,
        String idempotencyKey
    ) {
        DocumentSnapshot snap = get(idempotencyRef(tenantId, projectId, commandName, idempotencyKey));
        if (!snap.exists()) {
            return findLegacyIdempotency(tenantId, projectId, commandName, idempotencyKey);
        }
        Map<String, Object> data = data(snap);
        WeeklyExpenseIdempotencyEntity entity = new WeeklyExpenseIdempotencyEntity(
            tenantId,
            text(data.get("projectId"), projectId),
            text(data.get("idempotencyKey"), idempotencyKey),
            text(data.get("commandName"), commandName),
            text(data.get("requestHash"), ""),
            text(data.get("responseJson"), "")
        );
        entity.restorePersistenceState(snap.getId(), instant(data.get("createdAt")));
        return Optional.of(entity);
    }

    private Optional<WeeklyExpenseIdempotencyEntity> findLegacyIdempotency(
        String tenantId,
        String projectId,
        String commandName,
        String idempotencyKey
    ) {
        DocumentSnapshot snap = get(legacyIdempotencyRef(tenantId, idempotencyKey));
        if (!snap.exists()) return Optional.empty();
        Map<String, Object> data = data(snap);
        String storedProjectId = text(data.get("projectId"), "");
        String storedCommandName = text(data.get("commandName"), "");
        if (!storedProjectId.equals(projectId) || !storedCommandName.equals(commandName)) {
            return Optional.empty();
        }
        WeeklyExpenseIdempotencyEntity entity = new WeeklyExpenseIdempotencyEntity(
            tenantId,
            storedProjectId,
            text(data.get("idempotencyKey"), idempotencyKey),
            storedCommandName,
            text(data.get("requestHash"), ""),
            text(data.get("responseJson"), "")
        );
        entity.restorePersistenceState(snap.getId(), instant(data.get("createdAt")));
        return Optional.of(entity);
    }

    @Override
    public WeeklyExpenseIdempotencyEntity saveIdempotency(WeeklyExpenseIdempotencyEntity idempotency) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("tenantId", idempotency.getTenantId());
        data.put("projectId", idempotency.getProjectId());
        data.put("idempotencyKey", idempotency.getIdempotencyKey());
        data.put("commandName", idempotency.getCommandName());
        data.put("requestHash", idempotency.getRequestHash());
        data.put("responseJson", idempotency.getResponseJson());
        data.put("createdAt", idempotency.getCreatedAt().toString());
        set(idempotencyRef(
            idempotency.getTenantId(),
            idempotency.getProjectId(),
            idempotency.getCommandName(),
            idempotency.getIdempotencyKey()
        ), data);
        return idempotency;
    }

    @Override
    public Optional<WeeklyExpenseSheetEntity> findSheetForUpdate(String tenantId, String projectId, String sheetKey) {
        DocumentSnapshot snap = get(expenseSheetRef(tenantId, projectId, sheetKey));
        if (!snap.exists()) return Optional.empty();
        return Optional.of(sheetMapper.toSheet(tenantId, projectId, sheetKey, data(snap)));
    }

    @Override
    public List<WeeklyExpenseSheetEntity> findSheets(String tenantId, String projectId) {
        QuerySnapshot snap = query(db.collection("orgs/" + tenantId + "/projects/" + projectId + "/expense_sheets"));
        List<WeeklyExpenseSheetEntity> sheets = new ArrayList<>();
        for (DocumentSnapshot doc : snap.getDocuments()) {
            sheets.add(sheetMapper.toSheet(tenantId, projectId, doc.getId(), data(doc)));
        }
        sheets.sort(Comparator.comparing(WeeklyExpenseSheetEntity::getSheetKey));
        return sheets;
    }

    @Override
    public WeeklyExpenseSheetEntity saveSheet(WeeklyExpenseSheetEntity sheet) {
        DocumentReference ref = expenseSheetRef(sheet.getTenantId(), sheet.getProjectId(), sheet.getSheetKey());
        Map<String, Object> existingDocument = cachedDocument(ref);
        Map<String, Object> next = sheetMapper.toExpenseSheetDocument(
            sheet,
            existingDocument,
            Instant.now(),
            "java-weekly-api"
        );
        set(ref, next);
        return sheetMapper.toSheet(sheet.getTenantId(), sheet.getProjectId(), sheet.getSheetKey(), next);
    }

    @Override
    public void flushSheet(WeeklyExpenseSheetEntity sheet) {
        // Firestore stores rows as an array document, so no intermediate flush is needed for reindexing.
        // Keeping this a no-op also preserves Firestore's transaction rule that all reads happen before writes.
    }

    @Override
    public List<SaveDraftResponse.ActualDelta> replaceActuals(
        WeeklyExpenseSheetEntity sheet,
        List<SaveDraftResponse.ActualDelta> deltas
    ) {
        requireValidatedCashflowWriteScope(sheet.getTenantId(), sheet.getProjectId());
        Map<String, Map<String, BigDecimal>> deltasByDoc = new LinkedHashMap<>();
        for (SaveDraftResponse.ActualDelta delta : deltas) {
            deltasByDoc
                .computeIfAbsent(cashflowWeekId(sheet.getProjectId(), delta.yearMonth(), delta.weekNo()), ignored -> new LinkedHashMap<>())
                .merge(delta.cashflowLine(), amount(delta.amount()), BigDecimal::add);
        }

        Map<String, Map<String, Object>> docs = new LinkedHashMap<>();
        QuerySnapshot existing = query(cashflowWeeks(tenant(sheet)).whereEqualTo("projectId", sheet.getProjectId()));
        for (DocumentSnapshot doc : existing.getDocuments()) {
            docs.put(doc.getId(), data(doc));
        }
        for (String docId : deltasByDoc.keySet()) {
            docs.putIfAbsent(docId, baseCashflowWeekDoc(tenant(sheet), sheet.getProjectId(), docId));
        }

        Map<String, Map<String, Object>> patches = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Object>> entry : docs.entrySet()) {
            String docId = entry.getKey();
            Map<String, Object> doc = entry.getValue();
            Map<String, BigDecimal> sheetDeltas = deltasByDoc.get(docId);
            if (!deltasByDoc.containsKey(docId) && !doc.containsKey("weeklyExpenseActualBySheet")) {
                continue;
            }
            List<SaveDraftResponse.ActualDelta> docDeltas = sheetDeltas == null
                ? List.of()
                : sheetDeltas.entrySet().stream()
                    .map(delta -> new SaveDraftResponse.ActualDelta(
                        parseCashflowWeekId(sheet.getProjectId(), docId).yearMonth(),
                        parseCashflowWeekId(sheet.getProjectId(), docId).weekNo(),
                        delta.getKey(),
                        delta.getValue()
                    ))
                    .toList();
            Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
                tenant(sheet),
                sheet.getProjectId(),
                sheet.getSheetKey(),
                doc,
                docDeltas,
                Instant.now()
            );
            Map<String, Object> existingBySheet = nestedMap(doc.get("weeklyExpenseActualBySheet"));
            Map<String, Object> nextBySheet = nestedMap(patch.get("weeklyExpenseActualBySheet"));
            if (revisionAmounts(existingBySheet.get(sheet.getSheetKey()))
                .equals(revisionAmounts(nextBySheet.get(sheet.getSheetKey())))) {
                continue;
            }
            WeekDocParts parsed = parseCashflowWeekId(sheet.getProjectId(), docId);
            patch.put("yearMonth", parsed.yearMonth());
            patch.put("weekNo", parsed.weekNo());
            patches.put(docId, patch);
        }
        requireCashflowMonthsOpen(
            tenant(sheet),
            sheet.getProjectId(),
            patches.values().stream().map(patch -> text(patch.get("yearMonth"), "")).toList()
        );
        requireCashflowWeeksOpen(
            tenant(sheet),
            sheet.getProjectId(),
            patches.values().stream()
                .map(patch -> new CashflowWeekScope(
                    text(patch.get("yearMonth"), ""),
                    intValue(patch.get("weekNo"), 0)
                ))
                .toList()
        );
        for (Map.Entry<String, Map<String, Object>> patch : patches.entrySet()) {
            set(cashflowWeekRef(tenant(sheet), patch.getKey()), patch.getValue());
        }
        return deltas;
    }

    @Override
    public List<WeeklyExpenseActualEntity> replaceActualLines(
        String tenantId,
        String projectId,
        String sheetKey,
        List<SaveDraftResponse.ActualDelta> deltas
    ) {
        requireValidatedCashflowWriteScope(tenantId, projectId);
        Map<String, Map<String, BigDecimal>> deltasByDoc = new LinkedHashMap<>();
        for (SaveDraftResponse.ActualDelta delta : deltas) {
            deltasByDoc
                .computeIfAbsent(cashflowWeekId(projectId, delta.yearMonth(), delta.weekNo()), ignored -> new LinkedHashMap<>())
                .merge(delta.cashflowLine(), amount(delta.amount()), BigDecimal::add);
        }

        Map<String, Map<String, Object>> docs = new LinkedHashMap<>();
        QuerySnapshot existing = query(cashflowWeeks(tenantId).whereEqualTo("projectId", projectId));
        for (DocumentSnapshot doc : existing.getDocuments()) {
            docs.put(doc.getId(), data(doc));
        }
        for (String docId : deltasByDoc.keySet()) {
            docs.putIfAbsent(docId, baseCashflowWeekDoc(tenantId, projectId, docId));
        }

        Map<String, Map<String, Object>> patches = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Object>> entry : docs.entrySet()) {
            String docId = entry.getKey();
            Map<String, Object> doc = entry.getValue();
            Map<String, BigDecimal> sheetDeltas = deltasByDoc.get(docId);
            if (!deltasByDoc.containsKey(docId) && !doc.containsKey("weeklyExpenseActualBySheet")) {
                continue;
            }
            WeekDocParts parsed = parseCashflowWeekId(projectId, docId);
            List<SaveDraftResponse.ActualDelta> docDeltas = sheetDeltas == null
                ? List.of()
                : sheetDeltas.entrySet().stream()
                    .map(delta -> new SaveDraftResponse.ActualDelta(
                        parsed.yearMonth(),
                        parsed.weekNo(),
                        delta.getKey(),
                        delta.getValue()
                    ))
                    .toList();
            Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
                tenantId,
                projectId,
                sheetKey,
                doc,
                docDeltas,
                Instant.now()
            );
            Map<String, Object> existingBySheet = nestedMap(doc.get("weeklyExpenseActualBySheet"));
            Map<String, Object> nextBySheet = nestedMap(patch.get("weeklyExpenseActualBySheet"));
            if (revisionAmounts(existingBySheet.get(sheetKey))
                .equals(revisionAmounts(nextBySheet.get(sheetKey)))) {
                continue;
            }
            patch.put("yearMonth", parsed.yearMonth());
            patch.put("weekNo", parsed.weekNo());
            patches.put(docId, patch);
        }
        requireCashflowMonthsOpen(
            tenantId,
            projectId,
            patches.values().stream().map(patch -> text(patch.get("yearMonth"), "")).toList()
        );
        requireCashflowWeeksOpen(
            tenantId,
            projectId,
            patches.values().stream()
                .map(patch -> new CashflowWeekScope(
                    text(patch.get("yearMonth"), ""),
                    intValue(patch.get("weekNo"), 0)
                ))
                .toList()
        );
        for (Map.Entry<String, Map<String, Object>> patch : patches.entrySet()) {
            set(cashflowWeekRef(tenantId, patch.getKey()), patch.getValue());
        }

        return deltas.stream()
            .map(delta -> {
                WeeklyExpenseActualEntity actual = new WeeklyExpenseActualEntity(
                    tenantId,
                    projectId,
                    sheetKey,
                    delta.yearMonth(),
                    delta.weekNo(),
                    delta.cashflowLine()
                );
                actual.setAmount(delta.amount());
                return actual;
            })
            .toList();
    }

    @Override
    public List<WeeklyExpenseActualEntity> findActualLines(String tenantId, String projectId) {
        return readActualLines(tenantId, projectId, false);
    }

    @Override
    public List<WeeklyExpenseActualEntity> findActualLinesForAudit(String tenantId, String projectId) {
        return readActualLines(tenantId, projectId, true);
    }

    @Override
    public WeeklyExpenseAuditEventEntity saveAuditEvent(WeeklyExpenseAuditEventEntity auditEvent) {
        DocumentReference ref = auditEvents(auditEvent.getTenantId()).document();
        auditEvent.restorePersistenceState(ref.getId(), auditEvent.getCreatedAt());
        set(ref, Map.of(
            "tenantId", auditEvent.getTenantId(),
            "projectId", auditEvent.getProjectId(),
            "sheetKey", auditEvent.getSheetKey(),
            "commandName", auditEvent.getCommandName(),
            "actorId", auditEvent.getActorId(),
            "actorRole", auditEvent.getActorRole(),
            "idempotencyKey", auditEvent.getIdempotencyKey(),
            "metadataJson", auditEvent.getMetadataJson(),
            "createdAt", auditEvent.getCreatedAt().toString()
        ));
        return auditEvent;
    }

    @Override
    public List<WeeklyExpenseAuditEventEntity> findAuditEventsForAudit(String tenantId, String projectId) {
        QuerySnapshot snap = query(auditEvents(tenantId).whereEqualTo("projectId", projectId));
        List<WeeklyExpenseAuditEventEntity> events = new ArrayList<>();
        for (DocumentSnapshot doc : snap.getDocuments()) {
            events.add(auditEventFromDocument(tenantId, projectId, doc));
        }
        events.sort(Comparator.comparing(WeeklyExpenseAuditEventEntity::getCreatedAt));
        return events;
    }

    @Override
    public List<WeeklyExpenseAuditEventEntity> findRecentAuditEvents(String tenantId, String projectId, int limit) {
        if (limit <= 0) return List.of();
        QuerySnapshot snap = query(auditEvents(tenantId)
            .whereEqualTo("projectId", projectId)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(limit));
        List<WeeklyExpenseAuditEventEntity> events = new ArrayList<>();
        for (DocumentSnapshot doc : snap.getDocuments()) {
            events.add(auditEventFromDocument(tenantId, projectId, doc));
        }
        return events;
    }

    private WeeklyExpenseAuditEventEntity auditEventFromDocument(String tenantId, String projectId, DocumentSnapshot doc) {
        Map<String, Object> data = data(doc);
        WeeklyExpenseAuditEventEntity event = new WeeklyExpenseAuditEventEntity(
            tenantId,
            projectId,
            text(data.get("sheetKey"), ""),
            text(data.get("commandName"), ""),
            text(data.get("actorId"), ""),
            text(data.get("actorRole"), ""),
            text(data.get("idempotencyKey"), ""),
            text(data.get("metadataJson"), "{}")
        );
        event.restorePersistenceState(doc.getId(), instant(data.get("createdAt")));
        return event;
    }

    @Override
    public WeeklyExpenseAuditExportEntity saveAuditExport(WeeklyExpenseAuditExportEntity auditExport) {
        DocumentReference ref = auditExports(auditExport.getTenantId()).document();
        auditExport.restorePersistenceState(ref.getId(), auditExport.getCreatedAt());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("tenantId", auditExport.getTenantId());
        data.put("projectId", auditExport.getProjectId());
        data.put("artifactType", auditExport.getArtifactType());
        data.put("artifactFileName", auditExport.getArtifactFileName());
        data.put("artifactSha256", auditExport.getArtifactSha256());
        data.put("artifactContent", auditExport.getArtifactContent());
        data.put("projectionLineCount", auditExport.getProjectionLineCount());
        data.put("actualLineCount", auditExport.getActualLineCount());
        data.put("auditEventCount", auditExport.getAuditEventCount());
        data.put("createdBy", auditExport.getCreatedBy());
        data.put("createdAt", auditExport.getCreatedAt().toString());
        set(ref, data);
        return auditExport;
    }

    @Override
    public WeeklyExpenseBankImportBatchEntity saveBankImportBatch(WeeklyExpenseBankImportBatchEntity batch) {
        String batchId = batch.getId() == null || batch.getId().isBlank() ? "bank-import-" + UUID.randomUUID() : batch.getId();
        batch.restorePersistenceState(batchId, batch.getStatus(), batch.getCreatedAt());
        set(bankImportBatchRef(batch.getTenantId(), batchId), Map.of(
            "tenantId", batch.getTenantId(),
            "projectId", batch.getProjectId(),
            "uploadName", batch.getUploadName(),
            "columnsJson", batch.getColumnJson(),
            "status", batch.getStatus(),
            "createdBy", batch.getCreatedBy(),
            "createdAt", batch.getCreatedAt().toString()
        ));
        for (WeeklyExpenseBankImportLineEntity line : batch.getLines()) {
            saveBankImportLine(line);
        }
        return batch;
    }

    @Override
    public Optional<WeeklyExpenseBankImportLineEntity> findBankImportLineBySourceKey(
        String tenantId,
        String projectId,
        String sourceLineKey
    ) {
        DocumentSnapshot snap = get(expenseIntakeRef(tenantId, projectId, sourceLineKey));
        if (!snap.exists()) return Optional.empty();
        return Optional.of(toBankImportLine(tenantId, projectId, snap));
    }

    @Override
    public List<WeeklyExpenseBankImportLineEntity> findBankImportLines(String tenantId, String projectId, String status) {
        QuerySnapshot snap = query(expenseIntake(tenantId, projectId));
        List<WeeklyExpenseBankImportLineEntity> lines = new ArrayList<>();
        for (DocumentSnapshot doc : snap.getDocuments()) {
            WeeklyExpenseBankImportLineEntity line = toBankImportLine(tenantId, projectId, doc);
            if (status == null || status.equals(line.getStatus())) {
                lines.add(line);
            }
        }
        lines.sort(Comparator.comparing(line -> line.getBatch().getCreatedAt(), Comparator.reverseOrder()));
        return lines;
    }

    @Override
    public List<WeeklyExpenseBankImportLineEntity> findBankImportLinesForUpdate(
        String tenantId,
        String projectId,
        Collection<String> ids
    ) {
        List<WeeklyExpenseBankImportLineEntity> lines = new ArrayList<>();
        for (String id : ids) {
            findBankImportLineBySourceKey(tenantId, projectId, id).ifPresent(lines::add);
        }
        return lines;
    }

    @Override
    public List<WeeklyExpenseBankImportLineEntity> saveBankImportLines(List<WeeklyExpenseBankImportLineEntity> lines) {
        for (WeeklyExpenseBankImportLineEntity line : lines) saveBankImportLine(line);
        return lines;
    }

    @Override
    public Optional<WeeklyExpenseProjectionEntity> findProjectionLine(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo,
        String cashflowLine
    ) {
        DocumentReference ref = cashflowWeekRef(tenantId, cashflowWeekId(projectId, yearMonth, weekNo));
        Optional<Map<String, Object>> cached = cachedDocumentIfPresent(ref);
        if (cached.isPresent()) {
            Map<String, Object> doc = cached.get();
            if (doc.isEmpty()) return Optional.empty();
            Map<String, Object> projection = nestedMap(doc.get("projection"));
            if (!projection.containsKey(cashflowLine)) return Optional.empty();
            BigDecimal value = decimal(projection.get(cashflowLine));
            WeeklyExpenseProjectionEntity line = new WeeklyExpenseProjectionEntity(tenantId, projectId, yearMonth, weekNo, cashflowLine);
            line.setAmount(value);
            return Optional.of(line);
        }
        DocumentSnapshot snap = get(ref);
        if (!snap.exists()) return Optional.empty();
        Map<String, Object> projection = nestedMap(data(snap).get("projection"));
        if (!projection.containsKey(cashflowLine)) return Optional.empty();
        BigDecimal value = decimal(projection.get(cashflowLine));
        WeeklyExpenseProjectionEntity line = new WeeklyExpenseProjectionEntity(tenantId, projectId, yearMonth, weekNo, cashflowLine);
        line.setAmount(value);
        return Optional.of(line);
    }

    @Override
    public WeeklyExpenseProjectionEntity saveProjection(WeeklyExpenseProjectionEntity projection) {
        requireValidatedCashflowWriteScope(projection.getTenantId(), projection.getProjectId());
        requireCashflowMonthsOpen(
            projection.getTenantId(),
            projection.getProjectId(),
            List.of(projection.getYearMonth())
        );
        String docId = cashflowWeekId(projection.getProjectId(), projection.getYearMonth(), projection.getWeekNo());
        DocumentReference ref = cashflowWeekRef(projection.getTenantId(), docId);
        Map<String, Object> cached = cachedDocument(ref);
        Map<String, Object> doc = cached.isEmpty()
            ? baseCashflowWeekDoc(projection.getTenantId(), projection.getProjectId(), docId)
            : cached;
        Map<String, Object> projectionMap = nestedMap(doc.get("projection"));
        BigDecimal nextAmount = amount(projection.getAmount());
        if (
            projectionMap.containsKey(projection.getCashflowLine())
            && nextAmount.compareTo(decimal(projectionMap.get(projection.getCashflowLine()))) == 0
        ) {
            return projection;
        }
        requireCashflowWeeksOpen(
            projection.getTenantId(),
            projection.getProjectId(),
            List.of(new CashflowWeekScope(projection.getYearMonth(), projection.getWeekNo()))
        );
        projectionMap.put(projection.getCashflowLine(), nextAmount.longValue());
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("tenantId", projection.getTenantId());
        patch.put("projectId", projection.getProjectId());
        patch.put("yearMonth", projection.getYearMonth());
        patch.put("weekNo", projection.getWeekNo());
        patch.put("projection", projectionMap);
        patch.put("projectionTotals", FirestoreCashflowWeekActualMerge.cashflowTotals(decimalMap(projectionMap)));
        patch.put("projectionUpdated", true);
        patch.put("projectionUpdatedAt", Instant.now().toString());
        patch.put("updatedAt", Instant.now().toString());
        set(ref, patch);
        return projection;
    }

    @Override
    public List<WeeklyExpenseProjectionEntity> findProjectionLines(String tenantId, String projectId) {
        return readProjectionLines(tenantId, projectId);
    }

    @Override
    public List<WeeklyExpenseProjectionEntity> findProjectionLinesForAudit(String tenantId, String projectId) {
        return readProjectionLines(tenantId, projectId).stream()
            .sorted(Comparator
                .comparing(WeeklyExpenseProjectionEntity::getYearMonth)
                .thenComparingInt(WeeklyExpenseProjectionEntity::getWeekNo)
                .thenComparing(WeeklyExpenseProjectionEntity::getCashflowLine))
            .toList();
    }

    @Override
    public Optional<WeeklyExpenseWeeklyStatusEntity> findWeeklyStatus(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo
    ) {
        DocumentSnapshot snap = get(cashflowWeekRef(tenantId, cashflowWeekId(projectId, yearMonth, weekNo)));
        if (!snap.exists()) return Optional.empty();
        return Optional.of(toWeeklyStatus(tenantId, projectId, yearMonth, weekNo, snap));
    }

    @Override
    public WeeklyExpenseWeeklyStatusEntity saveWeeklyStatus(WeeklyExpenseWeeklyStatusEntity status) {
        requireValidatedCashflowWriteScope(status.getTenantId(), status.getProjectId());
        requireCashflowMonthsOpen(
            status.getTenantId(),
            status.getProjectId(),
            List.of(status.getYearMonth())
        );
        DocumentReference ref = cashflowWeekRef(
            status.getTenantId(),
            cashflowWeekId(status.getProjectId(), status.getYearMonth(), status.getWeekNo())
        );
        Map<String, Object> current = cachedDocumentIfPresent(ref).orElseGet(() -> {
            DocumentSnapshot snapshot = get(ref);
            return snapshot.exists() ? data(snapshot) : Map.of();
        });
        boolean nextSubmitted = status.getSubmittedAt() != null;
        boolean nextClosed = "closed".equals(status.getState());
        boolean statusChanged = !status.getState().equals(text(current.get("weeklyStatusState"), ""))
            || nextSubmitted != revisionBoolean(current.get("pmSubmitted"))
            || nextClosed != revisionBoolean(current.get("adminClosed"));
        if (!statusChanged) return status;
        requireCashflowWeeksOpen(
            status.getTenantId(),
            status.getProjectId(),
            List.of(new CashflowWeekScope(status.getYearMonth(), status.getWeekNo()))
        );
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("tenantId", status.getTenantId());
        patch.put("projectId", status.getProjectId());
        patch.put("yearMonth", status.getYearMonth());
        patch.put("weekNo", status.getWeekNo());
        patch.put("pmSubmitted", status.getSubmittedAt() != null);
        patch.put("pmSubmittedAt", instantString(status.getSubmittedAt()));
        patch.put("pmSubmittedBy", status.getSubmittedBy());
        patch.put("adminClosed", "closed".equals(status.getState()));
        patch.put("adminClosedAt", instantString(status.getClosedAt()));
        patch.put("adminClosedBy", status.getClosedBy());
        patch.put("weeklyStatusState", status.getState());
        patch.put("updatedAt", status.getUpdatedAt().toString());
        set(ref, patch);
        return status;
    }

    @Override
    public List<WeeklyExpenseWeeklyStatusEntity> findWeeklyStatuses(String tenantId, String projectId) {
        QuerySnapshot snap = query(cashflowWeeks(tenantId).whereEqualTo("projectId", projectId));
        List<WeeklyExpenseWeeklyStatusEntity> statuses = new ArrayList<>();
        for (DocumentSnapshot doc : snap.getDocuments()) {
            Map<String, Object> data = data(doc);
            statuses.add(toWeeklyStatus(
                tenantId,
                projectId,
                text(data.get("yearMonth"), ""),
                intValue(data.get("weekNo"), 0),
                doc
            ));
        }
        statuses.sort(Comparator
            .comparing(WeeklyExpenseWeeklyStatusEntity::getYearMonth, Comparator.reverseOrder())
            .thenComparingInt(WeeklyExpenseWeeklyStatusEntity::getWeekNo));
        return statuses;
    }

    private void saveBankImportLine(WeeklyExpenseBankImportLineEntity line) {
        if (line.getId() == null || line.getId().isBlank()) {
            line.restorePersistenceState(line.getSourceLineKey(), line.getStatus(), line.getAppliedSheetKey(), line.getAppliedRowId(), line.getAppliedAt(), line.getAppliedBy());
        }
        Map<String, Object> bankSnapshot = new LinkedHashMap<>();
        bankSnapshot.put("dateTime", line.getTransactionDate());
        bankSnapshot.put("counterparty", line.getCounterparty());
        bankSnapshot.put("memo", line.getMemo());
        bankSnapshot.put("signedAmount", line.getSignedAmount().longValue());
        bankSnapshot.put("balanceAfter", line.getBalanceAfter().longValue());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("tenantId", line.getBatch().getTenantId());
        data.put("projectId", line.getBatch().getProjectId());
        data.put("id", line.getId());
        data.put("bankFingerprint", line.getSourceLineKey());
        data.put("sourceTxId", "bank:" + line.getSourceLineKey());
        data.put("lastUploadBatchId", line.getBatch().getId());
        data.put("uploadName", line.getBatch().getUploadName());
        data.put("lineIndex", line.getLineIndex());
        data.put("status", line.getStatus());
        data.put("matchState", line.isApplied() ? "APPLIED" : "PENDING_INPUT");
        data.put("bankSnapshot", bankSnapshot);
        data.put("rawCellsJson", line.getRawCellsJson());
        data.put("existingExpenseSheetId", line.getAppliedSheetKey());
        data.put("existingExpenseRowTempId", line.getAppliedRowId());
        data.put("appliedAt", instantString(line.getAppliedAt()));
        data.put("appliedBy", line.getAppliedBy());
        set(expenseIntakeRef(line.getBatch().getTenantId(), line.getBatch().getProjectId(), line.getSourceLineKey()), data);
    }

    private WeeklyExpenseBankImportLineEntity toBankImportLine(String tenantId, String projectId, DocumentSnapshot snap) {
        Map<String, Object> data = data(snap);
        Map<String, Object> bankSnapshot = nestedMap(data.get("bankSnapshot"));
        String batchId = text(data.get("lastUploadBatchId"), "legacy-intake");
        WeeklyExpenseBankImportBatchEntity batch = new WeeklyExpenseBankImportBatchEntity(
            tenantId,
            projectId,
            text(data.get("uploadName"), "firestore-intake"),
            "[]",
            text(data.get("createdBy"), "firestore")
        );
        batch.restorePersistenceState(batchId, text(data.get("batchStatus"), "staged"), instant(data.get("createdAt")));
        WeeklyExpenseBankImportLineEntity line = new WeeklyExpenseBankImportLineEntity(
            batch,
            intValue(data.get("lineIndex"), 0),
            text(data.get("bankFingerprint"), snap.getId()),
            text(bankSnapshot.get("dateTime"), ""),
            text(bankSnapshot.get("counterparty"), ""),
            text(bankSnapshot.get("memo"), ""),
            decimal(bankSnapshot.get("signedAmount")),
            decimal(bankSnapshot.get("balanceAfter")),
            text(data.get("rawCellsJson"), "[]")
        );
        String status = text(data.get("status"), booleanValue(data.get("existingExpenseRowTempId")) ? "applied" : "staged");
        line.restorePersistenceState(
            snap.getId(),
            "APPLIED".equals(text(data.get("matchState"), "")) ? "applied" : status,
            text(data.get("existingExpenseSheetId"), null),
            text(data.get("existingExpenseRowTempId"), null),
            instant(data.get("appliedAt")),
            text(data.get("appliedBy"), null)
        );
        batch.addLine(line);
        return line;
    }

    private List<WeeklyExpenseProjectionEntity> readProjectionLines(String tenantId, String projectId) {
        QuerySnapshot snap = query(cashflowWeeks(tenantId).whereEqualTo("projectId", projectId));
        List<WeeklyExpenseProjectionEntity> lines = new ArrayList<>();
        for (DocumentSnapshot doc : snap.getDocuments()) {
            Map<String, Object> data = data(doc);
            String yearMonth = text(data.get("yearMonth"), "");
            int weekNo = intValue(data.get("weekNo"), 0);
            for (Map.Entry<String, Object> entry : nestedMap(data.get("projection")).entrySet()) {
                WeeklyExpenseProjectionEntity line = new WeeklyExpenseProjectionEntity(tenantId, projectId, yearMonth, weekNo, entry.getKey());
                line.setAmount(decimal(entry.getValue()));
                lines.add(line);
            }
        }
        return lines;
    }

    private List<WeeklyExpenseActualEntity> readActualLines(String tenantId, String projectId, boolean auditOrder) {
        QuerySnapshot snap = query(cashflowWeeks(tenantId).whereEqualTo("projectId", projectId));
        List<WeeklyExpenseActualEntity> lines = new ArrayList<>();
        for (DocumentSnapshot doc : snap.getDocuments()) {
            Map<String, Object> data = data(doc);
            String yearMonth = text(data.get("yearMonth"), "");
            int weekNo = intValue(data.get("weekNo"), 0);
            Map<String, Object> bySheet = nestedMap(data.get("weeklyExpenseActualBySheet"));
            if (!bySheet.isEmpty()) {
                for (Map.Entry<String, Object> sheetEntry : bySheet.entrySet()) {
                    for (Map.Entry<String, Object> lineEntry : nestedMap(sheetEntry.getValue()).entrySet()) {
                        WeeklyExpenseActualEntity line = new WeeklyExpenseActualEntity(
                            tenantId,
                            projectId,
                            sheetEntry.getKey(),
                            yearMonth,
                            weekNo,
                            lineEntry.getKey()
                        );
                        line.setAmount(decimal(lineEntry.getValue()));
                        lines.add(line);
                    }
                }
                continue;
            }
        }
        if (!auditOrder) return lines;
        return lines.stream()
            .sorted(Comparator
                .comparing(WeeklyExpenseActualEntity::getYearMonth)
                .thenComparingInt(WeeklyExpenseActualEntity::getWeekNo)
                .thenComparing(WeeklyExpenseActualEntity::getSheetKey)
                .thenComparing(WeeklyExpenseActualEntity::getCashflowLine))
            .toList();
    }

    private WeeklyExpenseWeeklyStatusEntity toWeeklyStatus(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo,
        DocumentSnapshot snap
    ) {
        Map<String, Object> data = data(snap);
        WeeklyExpenseWeeklyStatusEntity status = new WeeklyExpenseWeeklyStatusEntity(tenantId, projectId, yearMonth, weekNo);
        boolean closed = bool(data.get("adminClosed"));
        boolean submitted = bool(data.get("pmSubmitted"));
        status.restorePersistenceState(
            snap.getId(),
            closed ? "closed" : submitted ? "submitted" : text(data.get("weeklyStatusState"), "draft"),
            text(data.get("pmSubmittedBy"), null),
            instant(data.get("pmSubmittedAt")),
            text(data.get("adminClosedBy"), null),
            instant(data.get("adminClosedAt")),
            instant(data.get("updatedAt"))
        );
        return status;
    }

    private DocumentReference expenseSheetRef(String tenantId, String projectId, String sheetKey) {
        return db.document("orgs/" + tenantId + "/projects/" + projectId + "/expense_sheets/" + sheetKey);
    }

    private CollectionReference cashflowWeeks(String tenantId) {
        return db.collection("orgs/" + tenantId + "/cashflow_weeks");
    }

    private DocumentReference cashflowWeekRef(String tenantId, String docId) {
        return cashflowWeeks(tenantId).document(docId);
    }

    private DocumentReference cashflowYearTotalRef(String tenantId, String projectId, int year) {
        return db.document(
            "orgs/" + tenantId + "/cashflow_sheet_year_totals/" + safeDocId(projectId + "\n" + year)
        );
    }

    private CollectionReference expenseIntake(String tenantId, String projectId) {
        return db.collection("orgs/" + tenantId + "/projects/" + projectId + "/expense_intake");
    }

    private DocumentReference expenseIntakeRef(String tenantId, String projectId, String lineKey) {
        return expenseIntake(tenantId, projectId).document(lineKey);
    }

    private DocumentReference idempotencyRef(String tenantId, String projectId, String commandName, String idempotencyKey) {
        return db.document("orgs/" + tenantId + "/weekly_api_idempotency/" + safeDocId(
            projectId + "\n" + commandName + "\n" + idempotencyKey
        ));
    }

    private DocumentReference legacyIdempotencyRef(String tenantId, String idempotencyKey) {
        return db.document("orgs/" + tenantId + "/weekly_api_idempotency/" + safeDocId(idempotencyKey));
    }

    private CollectionReference auditEvents(String tenantId) {
        return db.collection("orgs/" + tenantId + "/weekly_api_audit_events");
    }

    private CollectionReference auditExports(String tenantId) {
        return db.collection("orgs/" + tenantId + "/weekly_api_audit_exports");
    }

    private DocumentReference bankImportBatchRef(String tenantId, String batchId) {
        return db.document("orgs/" + tenantId + "/weekly_bank_import_batches/" + batchId);
    }

    private DocumentSnapshot get(DocumentReference ref) {
        try {
            Transaction tx = currentTransaction.get();
            DocumentSnapshot snap = tx == null ? ref.get().get() : tx.get(ref).get();
            cacheDocument(ref, snap.exists() ? data(snap) : Map.of());
            return snap;
        } catch (Exception error) {
            throw new IllegalStateException("Could not read Firestore document: " + ref.getPath(), error);
        }
    }

    private List<DocumentSnapshot> getAll(DocumentReference... refs) {
        try {
            Transaction tx = currentTransaction.get();
            List<DocumentSnapshot> snapshots = tx == null ? db.getAll(refs).get() : tx.getAll(refs).get();
            for (DocumentSnapshot snap : snapshots) {
                cacheDocument(snap.getReference(), snap.exists() ? data(snap) : Map.of());
            }
            return snapshots;
        } catch (Exception error) {
            throw new IllegalStateException("Could not read Firestore documents.", error);
        }
    }

    private QuerySnapshot query(Query query) {
        try {
            Transaction tx = currentTransaction.get();
            QuerySnapshot snap = tx == null ? query.get().get() : tx.get(query).get();
            for (DocumentSnapshot doc : snap.getDocuments()) {
                cacheDocument(doc.getReference(), data(doc));
            }
            return snap;
        } catch (Exception error) {
            throw new IllegalStateException("Could not query Firestore.", error);
        }
    }

    private void set(DocumentReference ref, Map<String, Object> data) {
        try {
            if (ref.getPath().contains("/cashflow_weeks/")) {
                requireValidatedCashflowWriteScope(
                    text(data.get("tenantId"), ""),
                    text(data.get("projectId"), "")
                );
                requireCachedCashflowMonthOpen(
                    text(data.get("tenantId"), ""),
                    text(data.get("projectId"), ""),
                    text(data.get("yearMonth"), "")
                );
            }
            Transaction tx = currentTransaction.get();
            if (tx == null) {
                ref.set(data, SetOptions.merge()).get();
            } else {
                tx.set(ref, data, SetOptions.merge());
            }
            mergeCachedDocument(ref, data);
        } catch (RuntimeException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("Could not write Firestore document: " + ref.getPath(), error);
        }
    }

    private void replaceDocument(DocumentReference ref, Map<String, Object> data) {
        try {
            requireValidatedCashflowWriteScope(
                text(data.get("tenantId"), ""),
                text(data.get("projectId"), "")
            );
            if (ref.getPath().contains("/cashflow_weeks/")) {
                requireCachedCashflowMonthOpen(
                    text(data.get("tenantId"), ""),
                    text(data.get("projectId"), ""),
                    text(data.get("yearMonth"), "")
                );
            }
            Transaction tx = currentTransaction.get();
            if (tx == null) {
                ref.set(data).get();
            } else {
                tx.set(ref, data);
            }
            Map<String, Map<String, Object>> cache = transactionDocumentCache.get();
            if (cache != null) {
                cache.put(ref.getPath(), new LinkedHashMap<>(data));
            }
        } catch (RuntimeException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("Could not replace Firestore document: " + ref.getPath(), error);
        }
    }

    private void replacePrivateDraftDocument(DocumentReference ref, Map<String, Object> data) {
        if (!ref.getPath().contains("/privateEditDrafts/")) {
            throw new IllegalArgumentException("Private draft path is invalid.");
        }
        try {
            Transaction tx = currentTransaction.get();
            if (tx == null) {
                ref.set(data).get();
            } else {
                tx.set(ref, data);
            }
            Map<String, Map<String, Object>> cache = transactionDocumentCache.get();
            if (cache != null) cache.put(ref.getPath(), new LinkedHashMap<>(data));
        } catch (RuntimeException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("Could not replace private draft document: " + ref.getPath(), error);
        }
    }

    private Map<String, Object> cachedDocument(DocumentReference ref) {
        Map<String, Map<String, Object>> cache = transactionDocumentCache.get();
        if (cache == null) {
            DocumentSnapshot snap = get(ref);
            return snap.exists() ? data(snap) : Map.of();
        }
        return cache.getOrDefault(ref.getPath(), Map.of());
    }

    private Optional<Map<String, Object>> cachedDocumentIfPresent(DocumentReference ref) {
        Map<String, Map<String, Object>> cache = transactionDocumentCache.get();
        if (cache == null || !cache.containsKey(ref.getPath())) return Optional.empty();
        return Optional.of(cache.get(ref.getPath()));
    }

    private void cacheDocument(DocumentReference ref, Map<String, Object> data) {
        Map<String, Map<String, Object>> cache = transactionDocumentCache.get();
        if (cache != null) {
            cache.putIfAbsent(ref.getPath(), new LinkedHashMap<>(data));
        }
    }

    private void mergeCachedDocument(DocumentReference ref, Map<String, Object> patch) {
        Map<String, Map<String, Object>> cache = transactionDocumentCache.get();
        if (cache == null) return;
        Map<String, Object> current = new LinkedHashMap<>(cache.getOrDefault(ref.getPath(), Map.of()));
        current.putAll(patch);
        cache.put(ref.getPath(), current);
    }

    private Map<String, Object> data(DocumentSnapshot snap) {
        Map<String, Object> value = snap.getData();
        return value == null ? Map.of() : value;
    }

    private Map<String, Object> nestedMap(Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (!(value instanceof Map<?, ?> map)) return result;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            result.put(String.valueOf(entry.getKey()), entry.getValue());
        }
        return result;
    }

    private Map<String, BigDecimal> decimalMap(Map<String, Object> values) {
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            result.put(entry.getKey(), decimal(entry.getValue()));
        }
        return result;
    }

    private Map<String, Object> baseCashflowWeekDoc(String tenantId, String projectId, String docId) {
        WeekDocParts parts = parseCashflowWeekId(projectId, docId);
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("id", docId);
        doc.put("tenantId", tenantId);
        doc.put("projectId", projectId);
        doc.put("yearMonth", parts.yearMonth());
        doc.put("weekNo", parts.weekNo());
        doc.put("projection", Map.of());
        doc.put("actual", Map.of());
        doc.put("projectionTotals", FirestoreCashflowWeekActualMerge.cashflowTotals(Map.of()));
        doc.put("actualTotals", FirestoreCashflowWeekActualMerge.cashflowTotals(Map.of()));
        doc.put("pmSubmitted", false);
        doc.put("adminClosed", false);
        doc.put("createdAt", Instant.now().toString());
        return doc;
    }

    private String cashflowWeekId(String projectId, String yearMonth, int weekNo) {
        return projectId + "-" + yearMonth + "-w" + Math.max(1, Math.min(6, weekNo));
    }

    private WeekDocParts parseCashflowWeekId(String projectId, String docId) {
        String prefix = projectId + "-";
        String text = docId.startsWith(prefix) ? docId.substring(prefix.length()) : docId;
        int weekSep = text.lastIndexOf("-w");
        if (weekSep < 0) return new WeekDocParts("", 0);
        return new WeekDocParts(text.substring(0, weekSep), intValue(text.substring(weekSep + 2), 0));
    }

    private String safeDocId(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(String.valueOf(value).getBytes(StandardCharsets.UTF_8));
    }

    private String tenant(WeeklyExpenseSheetEntity sheet) {
        return sheet.getTenantId();
    }

    private <T> T call(Callable<T> action) {
        try {
            return action.call();
        } catch (RuntimeException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("Weekly expense persistence action failed.", error);
        }
    }

    private BigDecimal amount(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private BigDecimal decimal(Object value) {
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof Number number) {
            try {
                return new BigDecimal(number.toString());
            } catch (NumberFormatException error) {
                throw new IllegalArgumentException("Cashflow amounts must be finite numbers.", error);
            }
        }
        if (value == null) return BigDecimal.ZERO;
        String text = String.valueOf(value).replace(",", "").trim();
        if (text.isBlank()) return BigDecimal.ZERO;
        try {
            return new BigDecimal(text);
        } catch (NumberFormatException error) {
            return BigDecimal.ZERO;
        }
    }

    private int intValue(Object value, int fallback) {
        if (value instanceof Number number) return number.intValue();
        if (value == null) return fallback;
        try {
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    private long longValue(Object value, long fallback) {
        if (value instanceof Number number) return number.longValue();
        if (value == null) return fallback;
        try {
            return Long.parseLong(String.valueOf(value).trim());
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    private boolean bool(Object value) {
        if (value instanceof Boolean bool) return bool;
        if (value == null) return false;
        return Boolean.parseBoolean(String.valueOf(value));
    }

    private boolean booleanValue(Object value) {
        if (value == null) return false;
        if (value instanceof String text) return !text.isBlank();
        return true;
    }

    private String text(Object value, String fallback) {
        if (value == null) return fallback;
        String text = String.valueOf(value);
        return text.isBlank() ? fallback : text;
    }

    private Instant instant(Object value) {
        if (value instanceof Instant instant) return instant;
        if (value instanceof Timestamp timestamp) return timestamp.toSqlTimestamp().toInstant();
        if (value == null) return null;
        try {
            return Instant.parse(String.valueOf(value));
        } catch (Exception error) {
            return null;
        }
    }

    private String instantString(Instant value) {
        return value == null ? null : value.toString();
    }

    private void requireValidatedCashflowWriteScope(String tenantId, String projectId) {
        CashflowWriteScope scope = currentCashflowWriteScope.get();
        if (currentTransaction.get() == null || scope == null) {
            throw leaseError(
                503,
                "cashflow_write_permission_required",
                "Validated project write permission is required for canonical cashflow writes."
            );
        }
        if (!scope.tenantId().equals(tenantId) || !scope.projectId().equals(projectId)) {
            throw leaseError(
                423,
                "cashflow_write_scope_mismatch",
                "The validated cashflow write permission does not match this project."
            );
        }
    }

    private record WeekDocParts(String yearMonth, int weekNo) {
    }

    private record CashflowLeaseScope(
        String tenantId,
        String projectId,
        String actorId,
        String sessionId,
        String leaseId,
        long fence,
        boolean finalizeLease
    ) {
    }

    private record CashflowWriteScope(String tenantId, String projectId, String actorId) {
    }

    private record ValidatedCloseSource(
        String sourceReadAt,
        Map<String, Object> sheetFacts
    ) {
        private ValidatedCloseSource {
            sheetFacts = sheetFacts == null ? Map.of() : Map.copyOf(sheetFacts);
        }
    }

    private record StoredCashflowMonthCloseInput(
        String yearMonth,
        String sourceRevision,
        String targetRevision,
        List<CloseCashflowMonthRequest.DepositScheduleRow> depositScheduleRows,
        List<CashflowSheetLabApplyRequest.Cell> cells,
        List<CloseCashflowMonthRequest.Confirmation> confirmations,
        List<CloseCashflowMonthRequest.ManagementCheck> managementChecks,
        List<CloseCashflowMonthRequest.ManagementConfirmation> managementConfirmations,
        CloseCashflowMonthRequest.DeadlineSummary deadlineSummary
    ) {
    }
}
