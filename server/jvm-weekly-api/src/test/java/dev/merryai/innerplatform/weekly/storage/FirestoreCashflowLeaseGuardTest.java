package dev.merryai.innerplatform.weekly.storage;

import com.google.api.core.ApiFutures;
import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.Transaction;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseProjectionEntity;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class FirestoreCashflowLeaseGuardTest {
    private static final Instant NOW = Instant.parse("2026-07-10T10:00:00Z");
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a",
        "pm-1",
        "pm@example.com",
        "spoofed-client-role"
    );
    private static final CashflowEditSession SESSION = new CashflowEditSession(
        "stage-data-project",
        "session-a",
        "lease-a",
        7
    );

    @Test
    void validatesStoredMemberAndLeaseInTheSameTransactionAsCanonicalWrite() {
        Fixture fixture = fixture(activeMember(), activeLease());

        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> {
            org.assertj.core.api.Assertions.assertThat(
                fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION)
            ).isEqualTo("pm");
            WeeklyExpenseProjectionEntity projection = new WeeklyExpenseProjectionEntity(
                "tenant-a", "project-a", "2026-07", 1, "SALES_IN"
            );
            projection.setAmount(BigDecimal.valueOf(1000));
            fixture.persistence.saveProjection(projection);
            return null;
        })).doesNotThrowAnyException();

        verify(fixture.transaction).get(fixture.refs.get("orgs/tenant-a/members/pm-1"));
        verify(fixture.transaction).get(fixture.refs.get(leasePath("project-a")));
        verify(fixture.transaction).set(any(DocumentReference.class), any(), any());
    }

    @Test
    void rejectsExpiredOrReleasedLeaseBeforeAnyCanonicalWrite() {
        for (Map<String, Object> invalid : List.of(
            lease(Map.of("expiresAt", NOW.toString())),
            lease(Map.of("state", "RELEASED", "expiresAt", NOW.plusSeconds(600).toString()))
        )) {
            Fixture fixture = fixture(activeMember(), invalid);

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
                fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
                return null;
            }))
                .isInstanceOf(WeeklyExpenseEditLeaseException.class)
                .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
                .isEqualTo(410);
            verify(fixture.transaction, never()).set(any(DocumentReference.class), any(), any());
        }
    }

    @Test
    void rejectsStaleFenceAfterReacquireAndResourceMismatch() {
        for (Map<String, Object> invalid : List.of(
            lease(Map.of("leaseId", "lease-new", "fence", 8L)),
            lease(Map.of("resourceId", "project-b")),
            lease(Map.of("tenantId", "tenant-b"))
        )) {
            Fixture fixture = fixture(activeMember(), invalid);

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
                fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
                return null;
            }))
                .isInstanceOf(WeeklyExpenseEditLeaseException.class)
                .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
                .isEqualTo(423);
            verify(fixture.transaction, never()).set(any(DocumentReference.class), any(), any());
        }
    }

    @Test
    void rejectsMismatchedDataProjectAndUnassignedStoredMemberRole() {
        Fixture projectMismatch = fixture(activeMember(), activeLease());
        CashflowEditSession wrongProject = new CashflowEditSession("other-data-project", "session-a", "lease-a", 7);
        assertThatThrownBy(() -> projectMismatch.persistence.runCommandTransaction(() -> {
            projectMismatch.persistence.requireCashflowWriteLease(ACTOR, "project-a", wrongProject);
            return null;
        }))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
            .isEqualTo(503);

        Fixture unassigned = fixture(member(Map.of("role", "viewer", "projectIds", List.of("project-b"))), activeLease());
        assertThatThrownBy(() -> unassigned.persistence.runCommandTransaction(() -> {
            unassigned.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            return null;
        }))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
            .isEqualTo(403);
    }

    @Test
    void usesStoredRoleForCrossProjectAccessAndRequiresCanonicalProjectInTransaction() {
        Fixture finance = fixture(member(Map.of("role", "finance", "projectIds", List.of())), activeLease());
        assertThatCode(() -> finance.persistence.runCommandTransaction(() -> {
            finance.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            return null;
        })).doesNotThrowAnyException();

        Fixture missingProject = fixture(activeMember(), activeLease(), false);
        assertThatThrownBy(() -> missingProject.persistence.runCommandTransaction(() -> {
            missingProject.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            return null;
        }))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
            .isEqualTo(403);
        verify(missingProject.transaction, never()).set(any(DocumentReference.class), any(), any());
    }

    private static Fixture fixture(Map<String, Object> member, Map<String, Object> lease) {
        return fixture(member, lease, true);
    }

    private static Fixture fixture(Map<String, Object> member, Map<String, Object> lease, boolean projectExists) {
        Firestore db = mock(Firestore.class);
        Transaction transaction = mock(Transaction.class);
        CollectionReference collection = mock(CollectionReference.class);
        Map<String, DocumentReference> refs = new HashMap<>();
        Map<String, Map<String, Object>> docs = new HashMap<>();
        docs.put("orgs/tenant-a/members/pm-1", member);
        docs.put(leasePath("project-a"), lease);
        if (projectExists) {
            docs.put("orgs/tenant-a/projects/project-a", Map.of(
                "id", "project-a",
                "tenantId", "tenant-a"
            ));
        }

        when(db.document(anyString())).thenAnswer(invocation -> ref(refs, invocation.getArgument(0)));
        when(db.collection(anyString())).thenAnswer(invocation -> {
            String path = invocation.getArgument(0);
            when(collection.document(anyString())).thenAnswer(documentInvocation -> ref(
                refs,
                path + "/" + documentInvocation.getArgument(0)
            ));
            return collection;
        });
        when(transaction.get(any(DocumentReference.class))).thenAnswer(invocation -> {
            DocumentReference document = invocation.getArgument(0);
            Map<String, Object> data = docs.get(document.getPath());
            DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
            when(snapshot.exists()).thenReturn(data != null);
            when(snapshot.getData()).thenReturn(data);
            when(snapshot.getReference()).thenReturn(document);
            return ApiFutures.immediateFuture(snapshot);
        });
        when(db.runTransaction(any())).thenAnswer(invocation -> {
            Transaction.Function<?> function = invocation.getArgument(0);
            return ApiFutures.immediateFuture(function.updateCallback(transaction));
        });

        FirestoreInheritedWeeklyExpensePersistence persistence = new FirestoreInheritedWeeklyExpensePersistence(
            db,
            "stage-data-project",
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
        return new Fixture(persistence, transaction, refs);
    }

    private static DocumentReference ref(Map<String, DocumentReference> refs, String path) {
        return refs.computeIfAbsent(path, key -> {
            DocumentReference document = mock(DocumentReference.class);
            when(document.getPath()).thenReturn(key);
            return document;
        });
    }

    private static Map<String, Object> activeMember() {
        return member(Map.of());
    }

    private static Map<String, Object> member(Map<String, Object> overrides) {
        Map<String, Object> value = new HashMap<>(Map.of(
            "uid", "pm-1",
            "status", "ACTIVE",
            "role", "pm",
            "projectIds", List.of("project-a")
        ));
        value.putAll(overrides);
        return value;
    }

    private static Map<String, Object> activeLease() {
        return lease(Map.of());
    }

    private static Map<String, Object> lease(Map<String, Object> overrides) {
        Map<String, Object> value = new HashMap<>(Map.of(
            "tenantId", "tenant-a",
            "resourceType", "cashflow",
            "resourceId", "project-a",
            "holderUid", "pm-1",
            "sessionId", "session-a",
            "leaseId", "lease-a",
            "fence", 7L,
            "state", "ACTIVE",
            "expiresAt", NOW.plusSeconds(600).toString()
        ));
        value.putAll(overrides);
        return value;
    }

    private static String leasePath(String projectId) {
        String json = "[\"cashflow\",\"" + projectId + "\"]";
        String id = "v1_" + Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes());
        return "orgs/tenant-a/editLeases/" + id;
    }

    private record Fixture(
        FirestoreInheritedWeeklyExpensePersistence persistence,
        Transaction transaction,
        Map<String, DocumentReference> refs
    ) {
    }
}
