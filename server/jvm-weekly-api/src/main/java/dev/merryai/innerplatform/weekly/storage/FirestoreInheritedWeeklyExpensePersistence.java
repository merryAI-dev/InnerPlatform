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
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
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
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.Callable;

@Repository
@ConditionalOnProperty(name = "weekly.storage-backend", havingValue = "firestore")
public class FirestoreInheritedWeeklyExpensePersistence implements WeeklyExpensePersistence {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> CASHFLOW_WRITE_ROLES = Set.of("admin", "finance", "pm");
    private static final Set<String> CASHFLOW_CROSS_PROJECT_ROLES = Set.of("admin", "finance");
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
    private final FirestoreWeeklyExpenseDocumentMapper sheetMapper = new FirestoreWeeklyExpenseDocumentMapper();
    private final ThreadLocal<Transaction> currentTransaction = new ThreadLocal<>();
    private final ThreadLocal<Map<String, Map<String, Object>>> transactionDocumentCache = new ThreadLocal<>();
    private final ThreadLocal<CashflowLeaseScope> currentCashflowLeaseScope = new ThreadLocal<>();

    @Autowired
    public FirestoreInheritedWeeklyExpensePersistence(
        @Value("${weekly.firestore-project-id:}") String firestoreProjectId
    ) {
        this(createFirestore(firestoreProjectId), normalizeFirestoreProjectId(firestoreProjectId), Clock.systemUTC());
    }

    FirestoreInheritedWeeklyExpensePersistence(Firestore db, String firestoreProjectId, Clock clock) {
        this.db = db;
        this.firestoreProjectId = normalizeFirestoreProjectId(firestoreProjectId);
        this.clock = clock;
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
                try {
                    T result = call(action);
                    releaseCashflowLeaseAfterSuccessfulFinalCommand();
                    return result;
                } finally {
                    currentCashflowLeaseScope.remove();
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
    public String requireCashflowWriteLease(
        TrustedActorContext actor,
        String projectId,
        CashflowEditSession session
    ) {
        if (currentTransaction.get() == null) {
            throw leaseError(503, "cashflow_edit_lease_transaction_required", "Cashflow lease validation must run inside the canonical Firestore transaction.");
        }
        if (session == null || !firestoreProjectId.equals(session.dataProjectId())) {
            throw leaseError(503, "cashflow_data_project_mismatch", "BFF and JVM cashflow data projects do not match.");
        }
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
        return requireStoredCashflowWriter(member, actor, projectId);
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
        requireValidatedCashflowWriteScope(tenantId, projectId);
        cells = CashflowSheetLabApplyRequest.requireCompleteMonth(cells);
        Map<String, Map<String, Object>> targetMonthDocs = new TreeMap<>();
        for (int weekNo = 1; weekNo <= CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT; weekNo += 1) {
            String docId = cashflowWeekId(projectId, yearMonth, weekNo);
            DocumentSnapshot snap = get(cashflowWeekRef(tenantId, docId));
            if (!snap.exists()) continue;
            Map<String, Object> document = data(snap);
            requireCanonicalCashflowMonthDocument(projectId, yearMonth, weekNo, docId, document);
            targetMonthDocs.put(docId, document);
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
            if (!yearMonth.equals(storedYearMonth) && !yearMonth.equals(parts.yearMonth())) {
                continue;
            }
            requireCanonicalCashflowMonthDocument(
                projectId,
                yearMonth,
                parts.weekNo(),
                entry.getKey(),
                document
            );
            if (bool(document.get("adminClosed"))
                || "closed".equals(text(document.get("weeklyStatusState"), "").toLowerCase(Locale.ROOT))) {
                throw new WeeklyExpenseConflictException("Cashflow month is closed and cannot be changed.");
            }
            targetMonthDocs.put(entry.getKey(), document);
        }
        allProjectWeeks.putAll(targetMonthDocs);
        String currentRevision = computeCashflowTargetRevision(allProjectWeeks.values());
        if (!currentRevision.equals(targetRevision)) {
            throw new WeeklyExpenseConflictException("Cashflow target revision changed. Refresh the sheet before applying.");
        }

        DocumentSnapshot closeSnapshot = get(db.document(monthlyClosePath(tenantId, projectId, yearMonth)));
        if (closeSnapshot.exists()) {
            String status = text(data(closeSnapshot).get("status"), "OPEN").toUpperCase(Locale.ROOT);
            if ("CLOSED".equals(status) || "REOPEN_REQUESTED".equals(status)) {
                throw new WeeklyExpenseConflictException("Cashflow month is closed and cannot be changed.");
            }
        }

        Map<Integer, List<CashflowSheetLabApplyRequest.Cell>> cellsByWeek = new LinkedHashMap<>();
        for (CashflowSheetLabApplyRequest.Cell cell : cells) {
            cellsByWeek.computeIfAbsent(cell.weekNo(), ignored -> new ArrayList<>()).add(cell);
        }
        for (Integer weekNo : cellsByWeek.keySet()) {
            String docId = cashflowWeekId(projectId, yearMonth, weekNo);
            targetMonthDocs.putIfAbsent(docId, baseCashflowWeekDoc(tenantId, projectId, docId));
        }

        Instant now = clock.instant();
        Map<String, Map<String, Object>> replacements = new LinkedHashMap<>();
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
                now
            ));
            replacements.put(docId, replacement);
        }

        for (Map.Entry<String, Map<String, Object>> replacement : replacements.entrySet()) {
            replaceDocument(cashflowWeekRef(tenantId, replacement.getKey()), replacement.getValue());
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
        Comparator<WeeklyExpenseProjectionEntity> projectionOrder = Comparator
            .comparingInt(WeeklyExpenseProjectionEntity::getWeekNo)
            .thenComparing(WeeklyExpenseProjectionEntity::getCashflowLine);
        Comparator<WeeklyExpenseActualEntity> actualOrder = Comparator
            .comparingInt(WeeklyExpenseActualEntity::getWeekNo)
            .thenComparing(WeeklyExpenseActualEntity::getCashflowLine);
        projection.sort(projectionOrder);
        actual.sort(actualOrder);
        Map<String, Map<String, Object>> resultingWeeks = new LinkedHashMap<>(allProjectWeeks);
        resultingWeeks.putAll(replacements);
        return new CashflowSheetMonthReplacement(
            List.copyOf(projection),
            List.copyOf(actual),
            computeCashflowTargetRevision(resultingWeeks.values())
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
        String projectId
    ) {
        String memberUid = text(member.get("uid"), "");
        String storedRole = text(member.get("role"), "").toLowerCase(Locale.ROOT);
        if (member.isEmpty()
            || !"ACTIVE".equals(text(member.get("status"), "").toUpperCase(Locale.ROOT))
            || (!memberUid.isBlank() && !actor.id().equals(memberUid))
            || !CASHFLOW_WRITE_ROLES.contains(storedRole)
            || (!CASHFLOW_CROSS_PROJECT_ROLES.contains(storedRole) && !memberProjectIds(member).contains(projectId))) {
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
            set(cashflowWeekRef(tenant(sheet), docId), patch);
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
            set(cashflowWeekRef(tenantId, docId), patch);
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
            BigDecimal value = decimal(nestedMap(doc.get("projection")).get(cashflowLine));
            WeeklyExpenseProjectionEntity line = new WeeklyExpenseProjectionEntity(tenantId, projectId, yearMonth, weekNo, cashflowLine);
            line.setAmount(value);
            return Optional.of(line);
        }
        DocumentSnapshot snap = get(ref);
        if (!snap.exists()) return Optional.empty();
        BigDecimal value = decimal(nestedMap(data(snap).get("projection")).get(cashflowLine));
        WeeklyExpenseProjectionEntity line = new WeeklyExpenseProjectionEntity(tenantId, projectId, yearMonth, weekNo, cashflowLine);
        line.setAmount(value);
        return Optional.of(line);
    }

    @Override
    public WeeklyExpenseProjectionEntity saveProjection(WeeklyExpenseProjectionEntity projection) {
        requireValidatedCashflowWriteScope(projection.getTenantId(), projection.getProjectId());
        String docId = cashflowWeekId(projection.getProjectId(), projection.getYearMonth(), projection.getWeekNo());
        DocumentReference ref = cashflowWeekRef(projection.getTenantId(), docId);
        Map<String, Object> cached = cachedDocument(ref);
        Map<String, Object> doc = cached.isEmpty()
            ? baseCashflowWeekDoc(projection.getTenantId(), projection.getProjectId(), docId)
            : cached;
        Map<String, Object> projectionMap = nestedMap(doc.get("projection"));
        projectionMap.put(projection.getCashflowLine(), projection.getAmount().longValue());
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
        set(cashflowWeekRef(status.getTenantId(), cashflowWeekId(status.getProjectId(), status.getYearMonth(), status.getWeekNo())), patch);
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
            }
            Transaction tx = currentTransaction.get();
            if (tx == null) {
                ref.set(data, SetOptions.merge()).get();
            } else {
                tx.set(ref, data, SetOptions.merge());
            }
            mergeCachedDocument(ref, data);
        } catch (WeeklyExpenseEditLeaseException error) {
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
        } catch (WeeklyExpenseEditLeaseException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("Could not replace Firestore document: " + ref.getPath(), error);
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
        if (value instanceof Number number) return BigDecimal.valueOf(number.doubleValue());
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
        CashflowLeaseScope scope = currentCashflowLeaseScope.get();
        if (currentTransaction.get() == null || scope == null) {
            throw leaseError(
                503,
                "cashflow_edit_lease_required",
                "A validated cashflow edit lease is required for canonical cashflow writes."
            );
        }
        if (!scope.tenantId().equals(tenantId) || !scope.projectId().equals(projectId)) {
            throw leaseError(
                423,
                "cashflow_edit_lease_scope_mismatch",
                "The validated cashflow edit lease does not match this project."
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
}
