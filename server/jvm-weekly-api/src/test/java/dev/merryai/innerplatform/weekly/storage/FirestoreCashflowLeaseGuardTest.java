package dev.merryai.innerplatform.weekly.storage;

import com.google.api.core.ApiFutures;
import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.Query;
import com.google.cloud.firestore.QueryDocumentSnapshot;
import com.google.cloud.firestore.QuerySnapshot;
import com.google.cloud.firestore.Transaction;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyResponse;
import dev.merryai.innerplatform.weekly.api.CloseWeekRequest;
import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import dev.merryai.innerplatform.weekly.api.SaveDraftRequest;
import dev.merryai.innerplatform.weekly.api.SubmitWeekRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionRequest;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionResponse;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException;
import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseProjectionEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSheetEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseWeeklyStatusEntity;
import dev.merryai.innerplatform.weekly.service.WeeklyExpenseAuthorizationService;
import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import dev.merryai.innerplatform.weekly.service.WeeklyProjectExistenceRepository;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class FirestoreCashflowLeaseGuardTest {
    private static final String SOURCE_REVISION = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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
    private static final CashflowEditSession FINAL_SESSION = new CashflowEditSession(
        "stage-data-project",
        "session-a",
        "lease-a",
        7,
        true
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
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "ACTIVE")
            .doesNotContainKeys("releasedAt", "releaseReason");
    }

    @Test
    void finalCommandCommitsCanonicalWriteAndExactLeaseReleaseTogether() {
        Fixture fixture = fixture(activeMember(), activeLease());

        fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", FINAL_SESSION);
            fixture.persistence.saveProjection(projection("project-a"));
            return null;
        });

        assertThat(fixture.documents.get("orgs/tenant-a/cashflow_weeks/project-a-2026-07-w1"))
            .containsEntry("projectId", "project-a")
            .containsEntry("projectionUpdated", true)
            .containsKey("projection");
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "RELEASED")
            .containsEntry("releaseReason", "FINAL_SAVE")
            .containsEntry("leaseId", "lease-a")
            .containsEntry("fence", 7L);
    }

    @Test
    void noChangeFinalCommitsAuditIdempotencyAndExactLeaseReleaseWithoutCanonicalWrite() {
        Fixture fixture = fixture(activeMember(), activeLease());
        WeeklyExpenseCommandService service = commandService(fixture.persistence);

        UpsertProjectionResponse response = fixture.persistence.runCommandTransaction(() -> service.upsertProjection(
            ACTOR,
            "project-a",
            FINAL_SESSION,
            new UpsertProjectionRequest("finalize-no-change", List.of())
        ));

        assertThat(response.savedLineCount()).isZero();
        assertThat(fixture.documents.keySet())
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_audit_events/"))
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_idempotency/"));
        assertThat(fixture.documents.keySet())
            .noneMatch(path -> path.startsWith("orgs/tenant-a/cashflow_weeks/"));
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "RELEASED")
            .containsEntry("releaseReason", "FINAL_SAVE")
            .containsEntry("sessionId", "session-a")
            .containsEntry("leaseId", "lease-a")
            .containsEntry("fence", 7L);
    }

    @Test
    void noChangeFinalRejectsWrongSessionOrFenceWithoutAnyWrite() {
        for (CashflowEditSession invalid : List.of(
            new CashflowEditSession("stage-data-project", "session-other", "lease-a", 7, true),
            new CashflowEditSession("stage-data-project", "session-a", "lease-a", 8, true)
        )) {
            Fixture fixture = fixture(activeMember(), activeLease());

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
                fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", invalid);
                return null;
            }))
                .isInstanceOf(WeeklyExpenseEditLeaseException.class)
                .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
                .isEqualTo(423);
            verify(fixture.transaction, never()).set(any(DocumentReference.class), any(), any());
            assertThat(fixture.documents.get(leasePath("project-a")))
                .containsEntry("state", "ACTIVE")
                .doesNotContainKeys("releasedAt", "releaseReason");
        }
    }

    @Test
    void compoundCloseCommitsProjectionStatusAndLeaseReleaseTogether() {
        Fixture fixture = fixture(
            member(Map.of("role", "finance", "projectIds", List.of())),
            activeLease()
        );
        fixture.documents.put(weekPath(), submittedWeek());

        fixture.persistence.runCommandTransaction(() -> commandService(fixture.persistence).closeWeek(
            ACTOR,
            "project-a",
            FINAL_SESSION,
            closeRequest("compound-close-success", BigDecimal.valueOf(2500))
        ));

        assertThat(fixture.documents.get(weekPath()))
            .containsEntry("weeklyStatusState", "closed")
            .containsEntry("adminClosed", true);
        assertThat((Map<String, Object>) fixture.documents.get(weekPath()).get("projection"))
            .containsEntry("SALES_IN", 2500L);
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "RELEASED")
            .containsEntry("releaseReason", "FINAL_SAVE");
    }

    @Test
    void compoundCloseStatusFailureRollsBackStagedProjectionAndLeaseRelease() {
        Fixture fixture = fixture(
            member(Map.of("role", "finance", "projectIds", List.of())),
            activeLease()
        );
        fixture.documents.put(weekPath(), draftWeek());
        Map<String, Object> weekBefore = new LinkedHashMap<>(fixture.documents.get(weekPath()));
        Map<String, Object> leaseBefore = new LinkedHashMap<>(fixture.documents.get(leasePath("project-a")));

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(fixture.persistence).closeWeek(
            ACTOR,
            "project-a",
            FINAL_SESSION,
            closeRequest("compound-close-failure", BigDecimal.valueOf(9999))
        ))).isInstanceOf(dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException.class);

        assertThat(fixture.documents.get(weekPath())).isEqualTo(weekBefore);
        assertThat(fixture.documents.get(leasePath("project-a"))).isEqualTo(leaseBefore);
    }

    @Test
    void compoundSubmitCommitsRowsActualStatusAndLeaseReleaseTogether() {
        Fixture fixture = fixture(activeMember(), activeLease());

        fixture.persistence.runCommandTransaction(() -> commandService(fixture.persistence).submitWeek(
            ACTOR,
            "project-a",
            FINAL_SESSION,
            submitRequest("compound-submit-success")
        ));

        assertThat(fixture.documents.get(weekPath()))
            .containsEntry("weeklyStatusState", "submitted")
            .containsEntry("pmSubmitted", true)
            .containsKey("actual");
        assertThat(fixture.documents.get(sheetPath()))
            .containsEntry("projectId", "project-a")
            .containsKey("rows");
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "RELEASED")
            .containsEntry("releaseReason", "FINAL_SAVE");
    }

    @Test
    void compoundSubmitStatusFailureRollsBackStagedRowsActualAndLeaseRelease() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(weekPath(), closedWeek());
        Map<String, Object> weekBefore = new LinkedHashMap<>(fixture.documents.get(weekPath()));
        Map<String, Object> leaseBefore = new LinkedHashMap<>(fixture.documents.get(leasePath("project-a")));

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(fixture.persistence).submitWeek(
            ACTOR,
            "project-a",
            FINAL_SESSION,
            submitRequest("compound-submit-failure")
        ))).isInstanceOf(dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException.class);

        assertThat(fixture.documents).doesNotContainKey(sheetPath());
        assertThat(fixture.documents.get(weekPath())).isEqualTo(weekBefore);
        assertThat(fixture.documents.get(leasePath("project-a"))).isEqualTo(leaseBefore);
    }

    @Test
    void failedFinalCommandRollsBackCanonicalWriteAndLeaseRelease() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> leaseBefore = new LinkedHashMap<>(fixture.documents.get(leasePath("project-a")));

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", FINAL_SESSION);
            fixture.persistence.saveProjection(projection("project-a"));
            throw new IllegalStateException("fail after canonical write");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(fixture.documents).doesNotContainKey("orgs/tenant-a/cashflow_weeks/project-a-2026-07-w1");
        assertThat(fixture.documents.get(leasePath("project-a"))).isEqualTo(leaseBefore);
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

    @Test
    void everyCashflowWeekWriterFailsClosedWithoutAnExactValidatedLeaseScope() {
        Fixture fixture = fixture(activeMember(), activeLease());

        assertMissingScope(fixture, () -> fixture.persistence.saveProjection(projection("project-a")));
        assertMissingScope(fixture, () -> fixture.persistence.replaceActualLines(
            "tenant-a",
            "project-a",
            "cashflow-sheet-lab",
            List.of(new SaveDraftResponse.ActualDelta("2026-07", 1, "DIRECT_COST_OUT", BigDecimal.ONE))
        ));
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity("tenant-a", "project-a", "default", "Default");
        assertMissingScope(fixture, () -> fixture.persistence.replaceActuals(
            sheet,
            List.of(new SaveDraftResponse.ActualDelta("2026-07", 1, "DIRECT_COST_OUT", BigDecimal.ONE))
        ));
        assertMissingScope(fixture, () -> fixture.persistence.saveWeeklyStatus(
            new WeeklyExpenseWeeklyStatusEntity("tenant-a", "project-a", "2026-07", 1)
        ));

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            fixture.persistence.saveProjection(projection("project-b"));
            return null;
        }))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .satisfies(error -> {
                WeeklyExpenseEditLeaseException lease = (WeeklyExpenseEditLeaseException) error;
                org.assertj.core.api.Assertions.assertThat(lease.statusCode()).isEqualTo(423);
                org.assertj.core.api.Assertions.assertThat(lease.code()).isEqualTo("cashflow_edit_lease_scope_mismatch");
            });
    }

    @Test
    void validatedLeaseScopeDoesNotLeakIntoTheNextTransaction() {
        Fixture fixture = fixture(activeMember(), activeLease());

        fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            return null;
        });

        assertMissingScope(fixture, () -> fixture.persistence.saveProjection(projection("project-a")));
    }

    @Test
    void targetRevisionMatchesThePinnedBffCanonicalHash() {
        assertThat(FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of(Map.of(
            "yearMonth", "2026-07",
            "weekNo", 1,
            "projection", Map.of("SALES_IN", 100L),
            "actual", Map.of("DIRECT_COST_OUT", 50L),
            "adminClosed", false
        )))).isEqualTo("sha256:d0c7ee8769c18ba5371ae978e55eef55fd341df5aea288a298964fd06ced53f7");
    }

    @Test
    @SuppressWarnings("unchecked")
    void monthlyApplyReplacesProjectionAndOnlyTheSheetActualSource() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> july = draftWeek();
        july.put("projection", Map.of("SALES_IN", 999L, "STALE_LINE", 123L));
        july.put("weeklyExpenseActualBySheet", Map.of(
            "bank-import", Map.of("SALES_IN", 500L),
            "cashflow-sheet-lab", Map.of("DIRECT_COST_OUT", 999L)
        ));
        july.put("actual", Map.of("SALES_IN", 500L, "DIRECT_COST_OUT", 999L));
        fixture.documents.put(weekPath(), july);
        Map<String, Object> august = new LinkedHashMap<>(draftWeek());
        august.put("yearMonth", "2026-08");
        august.put("projection", Map.of("SALES_IN", 777L));
        String augustPath = "orgs/tenant-a/cashflow_weeks/project-a-2026-08-w1";
        fixture.documents.put(augustPath, august);
        Map<String, Object> augustBefore = new LinkedHashMap<>(august);
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(
            List.of(july, august)
        );

        CashflowSheetLabApplyResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest("monthly-authoritative", targetRevision, "projection:SALES_IN")
        ));

        Map<String, Object> saved = fixture.documents.get(weekPath());
        Map<String, Object> projection = (Map<String, Object>) saved.get("projection");
        Map<String, Object> bySheet = (Map<String, Object>) saved.get("weeklyExpenseActualBySheet");
        Map<String, Object> actual = (Map<String, Object>) saved.get("actual");
        assertThat(response.savedProjectionLineCount()).isEqualTo(79);
        assertThat(response.savedActualLineCount()).isEqualTo(80);
        assertThat(projection)
            .doesNotContainKeys("SALES_IN", "STALE_LINE")
            .containsEntry("DIRECT_COST_OUT", 100L);
        assertThat(bySheet).containsOnlyKeys("bank-import", "cashflow-sheet-lab");
        assertThat((Map<String, Object>) bySheet.get("bank-import")).containsEntry("SALES_IN", 500L);
        assertThat((Map<String, Object>) bySheet.get("cashflow-sheet-lab"))
            .containsEntry("DIRECT_COST_OUT", 100L)
            .containsEntry("SALES_IN", 100L);
        assertThat(actual).containsEntry("SALES_IN", 600L).containsEntry("DIRECT_COST_OUT", 100L);
        assertThat(saved.get("projectionTotals")).isEqualTo(Map.of("totalIn", 600L, "totalOut", 900L, "net", -300L));
        assertThat(saved.get("actualTotals")).isEqualTo(Map.of("totalIn", 1200L, "totalOut", 900L, "net", 300L));
        assertThat(fixture.documents.get(augustPath)).isEqualTo(augustBefore);
    }

    @Test
    void monthlyApplyRejectsTargetDriftAndAClosedMonthWithoutCanonicalWrites() {
        Fixture drifted = fixture(activeMember(), activeLease());
        assertThatThrownBy(() -> drifted.persistence.runCommandTransaction(() -> commandService(
            drifted.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest(
                "monthly-drift",
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                ""
            )
        ))).isInstanceOf(WeeklyExpenseConflictException.class).hasMessageContaining("revision");
        assertThat(drifted.documents.keySet()).noneMatch(path -> path.contains("cashflow_weeks"));

        Fixture closed = fixture(activeMember(), activeLease());
        closed.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-07", Map.of(
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "status", "CLOSED"
        ));
        assertThatThrownBy(() -> closed.persistence.runCommandTransaction(() -> commandService(
            closed.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest(
                "monthly-closed",
                "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44",
                ""
            )
        ))).isInstanceOf(WeeklyExpenseConflictException.class).hasMessageContaining("closed");
        assertThat(closed.documents.keySet()).noneMatch(path -> path.contains("cashflow_weeks"));
    }

    @Test
    void monthlyPersistenceRejectsOmittedWeeksBeforeReplacingExistingValues() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> existingWeekFive = new LinkedHashMap<>(draftWeek());
        existingWeekFive.put("weekNo", 5);
        existingWeekFive.put("projection", Map.of("SALES_IN", 555L));
        String weekFivePath = "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w5";
        fixture.documents.put(weekFivePath, existingWeekFive);
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(
            List.of(existingWeekFive)
        );
        List<CashflowSheetLabApplyRequest.Cell> firstFourWeeks = monthlyRequest(
            "direct-persistence-incomplete",
            targetRevision,
            ""
        ).cells().stream().filter(cell -> cell.weekNo() <= 4).toList();

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            return fixture.persistence.replaceCashflowSheetMonth(
                "tenant-a",
                "project-a",
                "cashflow-sheet-lab",
                "2026-07",
                targetRevision,
                firstFourWeeks
            );
        }))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("five weeks");

        assertThat(fixture.documents.get(weekFivePath)).isEqualTo(existingWeekFive);
    }

    @Test
    void monthlyApplyRejectsLegacySixthWeekUntilItIsMigrated() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> legacyWeekSix = new LinkedHashMap<>(draftWeek());
        legacyWeekSix.put("weekNo", 6);
        legacyWeekSix.put("projection", Map.of("SALES_IN", 666L));
        String weekSixPath = "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w6";
        fixture.documents.put(weekSixPath, legacyWeekSix);
        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest(
                "monthly-legacy-week-six",
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                ""
            )
        )))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("migration");

        assertThat(fixture.documents.get(weekSixPath)).isEqualTo(legacyWeekSix);
        assertThat(fixture.documents.keySet())
            .noneMatch(path -> path.matches(".*/project-a-2026-07-w[1-5]$"));
    }

    @Test
    void monthlyApplyRejectsNonCanonicalWeekDocumentIdsUntilTheyAreMigrated() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> legacyWeekOne = draftWeek();
        String legacyPath = "orgs/tenant-a/cashflow_weeks/legacy-july-week-one";
        fixture.documents.put(legacyPath, legacyWeekOne);
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(
            List.of(legacyWeekOne)
        );

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest("monthly-noncanonical-id", targetRevision, "")
        )))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("migration");

        assertThat(fixture.documents.get(legacyPath)).isEqualTo(legacyWeekOne);
        assertThat(fixture.documents.keySet())
            .noneMatch(path -> path.matches(".*/project-a-2026-07-w[1-5]$"));
    }

    @Test
    void monthlyApplyRejectsCanonicalIdsWithMissingMonthMetadataUntilTheyAreMigrated() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> malformedWeekOne = draftWeek();
        malformedWeekOne.remove("yearMonth");
        fixture.documents.put(weekPath(), malformedWeekOne);

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest(
                "monthly-missing-month-metadata",
                "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44",
                ""
            )
        )))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("migration");

        assertThat(fixture.documents.get(weekPath())).isEqualTo(malformedWeekOne);
        assertThat(fixture.documents.keySet())
            .noneMatch(path -> path.matches(".*/project-a-2026-07-w[2-5]$"));
    }

    @Test
    void exactReplayReturnsAfterFinalApplyReleasedTheLease() {
        Fixture fixture = fixture(activeMember(), activeLease());
        CashflowSheetLabApplyRequest request = monthlyRequest(
            "monthly-final-replay",
            "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44",
            ""
        );
        WeeklyExpenseCommandService service = commandService(fixture.persistence);

        CashflowSheetLabApplyResponse first = fixture.persistence.runCommandTransaction(() -> service.applyCashflowSheetLab(
            ACTOR, "project-a", FINAL_SESSION, request
        ));
        CashflowSheetLabApplyResponse replay = fixture.persistence.runCommandTransaction(() -> service.applyCashflowSheetLab(
            ACTOR, "project-a", FINAL_SESSION, request
        ));

        assertThat(replay).isEqualTo(first);
        assertThat(fixture.documents.get(leasePath("project-a"))).containsEntry("state", "RELEASED");
    }

    @Test
    void resultingRevisionChainsSequentialMonthApplies() {
        Fixture fixture = fixture(activeMember(), activeLease());
        WeeklyExpenseCommandService service = commandService(fixture.persistence);
        String emptyRevision = "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44";

        CashflowSheetLabApplyResponse july = fixture.persistence.runCommandTransaction(() -> service.applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest("monthly-chain-july", emptyRevision, "2026-07", "")
        ));
        CashflowSheetLabApplyResponse august = fixture.persistence.runCommandTransaction(() -> service.applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest("monthly-chain-august", july.resultingTargetRevision(), "2026-08", "")
        ));

        assertThat(july.resultingTargetRevision()).isNotEqualTo(emptyRevision);
        assertThat(august.resultingTargetRevision()).isNotEqualTo(july.resultingTargetRevision());
        assertThat(fixture.documents)
            .containsKeys(
                "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w1",
                "orgs/tenant-a/cashflow_weeks/project-a-2026-08-w1"
            );
    }

    private static void assertMissingScope(Fixture fixture, Runnable writer) {
        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
            writer.run();
            return null;
        }))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .satisfies(error -> {
                WeeklyExpenseEditLeaseException lease = (WeeklyExpenseEditLeaseException) error;
                org.assertj.core.api.Assertions.assertThat(lease.statusCode()).isEqualTo(503);
                org.assertj.core.api.Assertions.assertThat(lease.code()).isEqualTo("cashflow_edit_lease_required");
            });
    }

    private static WeeklyExpenseProjectionEntity projection(String projectId) {
        WeeklyExpenseProjectionEntity projection = new WeeklyExpenseProjectionEntity(
            "tenant-a", projectId, "2026-07", 1, "SALES_IN"
        );
        projection.setAmount(BigDecimal.ONE);
        return projection;
    }

    private static CloseWeekRequest closeRequest(String idempotencyKey, BigDecimal amount) {
        return new CloseWeekRequest(
            idempotencyKey,
            "2026-07",
            1,
            List.of(new UpsertProjectionRequest.ProjectionLinePatch(
                "2026-07", 1, "SALES_IN", amount
            ))
        );
    }

    private static SubmitWeekRequest submitRequest(String idempotencyKey) {
        return new SubmitWeekRequest(
            idempotencyKey,
            "2026-07",
            1,
            new SubmitWeekRequest.WeeklySheetSnapshot(
                "default",
                null,
                "기본 탭",
                List.of(new SaveDraftRequest.RowPatch(
                    0,
                    "row-0",
                    null,
                    "manual",
                    List.of(
                        new SaveDraftRequest.CellPatch(3, "2026-07-W1", true),
                        new SaveDraftRequest.CellPatch(8, "매출액", true),
                        new SaveDraftRequest.CellPatch(11, "500", true)
                    )
                ))
            )
        );
    }

    private static CashflowSheetLabApplyRequest monthlyRequest(
        String idempotencyKey,
        String targetRevision,
        String emptyCellKey
    ) {
        return monthlyRequest(idempotencyKey, targetRevision, "2026-07", emptyCellKey);
    }

    private static CashflowSheetLabApplyRequest monthlyRequest(
        String idempotencyKey,
        String targetRevision,
        String yearMonth,
        String emptyCellKey
    ) {
        List<CashflowSheetLabApplyRequest.Cell> cells = new ArrayList<>();
        for (int weekNo = 1; weekNo <= 5; weekNo += 1) {
            for (String mode : List.of("projection", "actual")) {
                for (String lineId : CashflowLineCatalog.ALL_LINES.stream().sorted(Comparator.naturalOrder()).toList()) {
                    boolean empty = weekNo == 1 && (mode + ":" + lineId).equals(emptyCellKey);
                    cells.add(new CashflowSheetLabApplyRequest.Cell(
                        mode,
                        weekNo,
                        lineId,
                        empty ? "EMPTY" : "VALUE",
                        empty ? null : BigDecimal.valueOf(100),
                        "D" + weekNo,
                        lineId
                    ));
                }
            }
        }
        return new CashflowSheetLabApplyRequest(
            idempotencyKey,
            SOURCE_REVISION,
            targetRevision,
            yearMonth,
            cells
        );
    }

    private static Fixture fixture(Map<String, Object> member, Map<String, Object> lease) {
        return fixture(member, lease, true);
    }

    @SuppressWarnings("unchecked")
    private static Fixture fixture(Map<String, Object> member, Map<String, Object> lease, boolean projectExists) {
        Firestore db = mock(Firestore.class);
        Transaction transaction = mock(Transaction.class);
        Map<String, DocumentReference> refs = new HashMap<>();
        Map<String, CollectionReference> collections = new HashMap<>();
        Map<Query, QueryScope> queryScopes = new HashMap<>();
        Map<String, Map<String, Object>> docs = new HashMap<>();
        List<PendingWrite> pendingWrites = new ArrayList<>();
        docs.put("orgs/tenant-a/members/pm-1", member);
        docs.put(leasePath("project-a"), lease);
        if (projectExists) {
            docs.put("orgs/tenant-a/projects/project-a", Map.of(
                "id", "project-a",
                "tenantId", "tenant-a"
            ));
        }

        when(db.document(anyString())).thenAnswer(invocation -> ref(refs, invocation.getArgument(0)));
        when(db.collection(anyString())).thenAnswer(invocation -> collection(
            collections,
            refs,
            queryScopes,
            invocation.getArgument(0)
        ));
        when(transaction.get(any(DocumentReference.class))).thenAnswer(invocation -> {
            DocumentReference document = invocation.getArgument(0);
            Map<String, Object> data = docs.get(document.getPath());
            DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
            when(snapshot.exists()).thenReturn(data != null);
            when(snapshot.getData()).thenReturn(data);
            when(snapshot.getReference()).thenReturn(document);
            return ApiFutures.immediateFuture(snapshot);
        });
        when(transaction.get(any(Query.class))).thenAnswer(invocation -> {
            QueryScope scope = queryScopes.get(invocation.getArgument(0));
            List<QueryDocumentSnapshot> snapshots = docs.entrySet().stream()
                .filter(entry -> scope != null && entry.getKey().startsWith(scope.collectionPath() + "/"))
                .filter(entry -> scope == null || java.util.Objects.equals(entry.getValue().get(scope.field()), scope.value()))
                .map(entry -> queryDocumentSnapshot(refs, entry.getKey(), entry.getValue()))
                .toList();
            QuerySnapshot querySnapshot = mock(QuerySnapshot.class);
            when(querySnapshot.getDocuments()).thenReturn(snapshots);
            return ApiFutures.immediateFuture(querySnapshot);
        });
        when(transaction.set(any(DocumentReference.class), any(), any())).thenAnswer(invocation -> {
            pendingWrites.add(new PendingWrite(
                invocation.getArgument(0),
                new LinkedHashMap<>((Map<String, Object>) invocation.getArgument(1))
            ));
            return transaction;
        });
        when(transaction.set(any(DocumentReference.class), any())).thenAnswer(invocation -> {
            pendingWrites.add(new PendingWrite(
                invocation.getArgument(0),
                new LinkedHashMap<>((Map<String, Object>) invocation.getArgument(1))
            ));
            return transaction;
        });
        when(db.runTransaction(any())).thenAnswer(invocation -> {
            Transaction.Function<?> function = invocation.getArgument(0);
            pendingWrites.clear();
            try {
                Object result = function.updateCallback(transaction);
                for (PendingWrite write : pendingWrites) {
                    Map<String, Object> document = new LinkedHashMap<>(docs.getOrDefault(write.ref().getPath(), Map.of()));
                    document.putAll(write.data());
                    docs.put(write.ref().getPath(), document);
                }
                pendingWrites.clear();
                return ApiFutures.immediateFuture(result);
            } catch (Throwable error) {
                pendingWrites.clear();
                return ApiFutures.immediateFailedFuture(error);
            }
        });

        FirestoreInheritedWeeklyExpensePersistence persistence = new FirestoreInheritedWeeklyExpensePersistence(
            db,
            "stage-data-project",
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
        return new Fixture(persistence, transaction, refs, docs);
    }

    private static DocumentReference ref(Map<String, DocumentReference> refs, String path) {
        return refs.computeIfAbsent(path, key -> {
            DocumentReference document = mock(DocumentReference.class);
            when(document.getPath()).thenReturn(key);
            when(document.getId()).thenReturn(key.substring(key.lastIndexOf('/') + 1));
            return document;
        });
    }

    private static CollectionReference collection(
        Map<String, CollectionReference> collections,
        Map<String, DocumentReference> refs,
        Map<Query, QueryScope> queryScopes,
        String path
    ) {
        return collections.computeIfAbsent(path, key -> {
            CollectionReference collection = mock(CollectionReference.class);
            when(collection.document(anyString())).thenAnswer(invocation -> ref(refs, key + "/" + invocation.getArgument(0)));
            when(collection.document()).thenAnswer(invocation -> ref(refs, key + "/generated-audit-id"));
            when(collection.whereEqualTo(anyString(), any())).thenAnswer(invocation -> {
                Query query = mock(Query.class);
                queryScopes.put(query, new QueryScope(key, invocation.getArgument(0), invocation.getArgument(1)));
                return query;
            });
            return collection;
        });
    }

    private static DocumentSnapshot snapshot(
        Map<String, DocumentReference> refs,
        String path,
        Map<String, Object> data
    ) {
        DocumentReference reference = ref(refs, path);
        DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
        when(snapshot.exists()).thenReturn(data != null);
        when(snapshot.getData()).thenReturn(data);
        when(snapshot.getReference()).thenReturn(reference);
        when(snapshot.getId()).thenReturn(path.substring(path.lastIndexOf('/') + 1));
        return snapshot;
    }

    private static QueryDocumentSnapshot queryDocumentSnapshot(
        Map<String, DocumentReference> refs,
        String path,
        Map<String, Object> data
    ) {
        DocumentReference reference = ref(refs, path);
        QueryDocumentSnapshot snapshot = mock(QueryDocumentSnapshot.class);
        when(snapshot.exists()).thenReturn(true);
        when(snapshot.getData()).thenReturn(data);
        when(snapshot.getReference()).thenReturn(reference);
        when(snapshot.getId()).thenReturn(path.substring(path.lastIndexOf('/') + 1));
        return snapshot;
    }

    private static WeeklyExpenseCommandService commandService(WeeklyExpensePersistence persistence) {
        WeeklyExpenseAuthorizationService authorization = new WeeklyExpenseAuthorizationService(
            (actor, projectId) -> true,
            new WeeklyProjectExistenceRepository() {
                @Override
                public boolean exists(String tenantId, String projectId) {
                    return true;
                }

                @Override
                public boolean existsCanonicalProject(String tenantId, String projectId) {
                    return true;
                }
            },
            "strict"
        );
        return new WeeklyExpenseCommandService(
            persistence,
            authorization,
            new ObjectMapper(),
            true,
            "stage"
        );
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

    private static String weekPath() {
        return "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w1";
    }

    private static String sheetPath() {
        return "orgs/tenant-a/projects/project-a/expense_sheets/default";
    }

    private static Map<String, Object> draftWeek() {
        return new LinkedHashMap<>(Map.of(
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "weekNo", 1,
            "weeklyStatusState", "draft",
            "pmSubmitted", false,
            "adminClosed", false,
            "projection", Map.of("SALES_IN", 100L)
        ));
    }

    private static Map<String, Object> submittedWeek() {
        Map<String, Object> value = draftWeek();
        value.put("weeklyStatusState", "submitted");
        value.put("pmSubmitted", true);
        value.put("pmSubmittedAt", NOW.minusSeconds(60).toString());
        value.put("pmSubmittedBy", "pm-1");
        return value;
    }

    private static Map<String, Object> closedWeek() {
        Map<String, Object> value = submittedWeek();
        value.put("weeklyStatusState", "closed");
        value.put("adminClosed", true);
        value.put("adminClosedAt", NOW.minusSeconds(30).toString());
        value.put("adminClosedBy", "finance-1");
        return value;
    }

    private record Fixture(
        FirestoreInheritedWeeklyExpensePersistence persistence,
        Transaction transaction,
        Map<String, DocumentReference> refs,
        Map<String, Map<String, Object>> documents
    ) {
    }

    private record PendingWrite(DocumentReference ref, Map<String, Object> data) {
    }

    private record QueryScope(String collectionPath, String field, Object value) {
    }
}
