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
import dev.merryai.innerplatform.weekly.api.CashflowMonthCloseResponse;
import dev.merryai.innerplatform.weekly.api.CashflowOpeningBalancesResponse;
import dev.merryai.innerplatform.weekly.api.CashflowOpeningBalanceCell;
import dev.merryai.innerplatform.weekly.api.CashflowSheetBatchApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetBatchApplyResponse;
import dev.merryai.innerplatform.weekly.api.CashflowSheetAnnualApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyResponse;
import dev.merryai.innerplatform.weekly.api.CashflowVarianceRequest;
import dev.merryai.innerplatform.weekly.api.CashflowVarianceResponse;
import dev.merryai.innerplatform.weekly.api.CloseCashflowMonthRequest;
import dev.merryai.innerplatform.weekly.api.CompleteCashflowWeeklyUpdateRequest;
import dev.merryai.innerplatform.weekly.api.CashflowWeeklyUpdateCompletionResponse;
import dev.merryai.innerplatform.weekly.api.CloseWeekRequest;
import dev.merryai.innerplatform.weekly.api.DecideCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.RequestCashflowMonthReopenRequest;
import dev.merryai.innerplatform.weekly.api.ReopenCashflowWeeklyUpdateRequest;
import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import dev.merryai.innerplatform.weekly.api.SaveDraftRequest;
import dev.merryai.innerplatform.weekly.api.SubmitWeekRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionRequest;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionResponse;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseForbiddenException;
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
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
    private static final TrustedActorContext READ_ACTOR = new TrustedActorContext(
        "tenant-a",
        "pm-1",
        "pm@example.com",
        "viewer"
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
    void projectionWritePersistsCanonicalDataWithoutChangingAnExistingLease() {
        Fixture fixture = fixture(activeMember(), activeLease());
        WeeklyExpenseCommandService service = commandService(fixture.persistence);

        UpsertProjectionResponse response = fixture.persistence.runCommandTransaction(() -> service.upsertProjection(
            ACTOR,
            "project-a",
            FINAL_SESSION,
            new UpsertProjectionRequest("projection-without-lease", List.of(
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07", 1, "SALES_IN", BigDecimal.ONE
                )
            ))
        ));

        assertThat(response.savedLineCount()).isEqualTo(1);
        assertThat(fixture.documents.keySet())
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_audit_events/"))
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_idempotency/"));
        assertThat(fixture.documents.keySet())
            .anyMatch(path -> path.startsWith("orgs/tenant-a/cashflow_weeks/"));
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "ACTIVE")
            .containsEntry("sessionId", "session-a")
            .containsEntry("leaseId", "lease-a")
            .containsEntry("fence", 7L)
            .doesNotContainKeys("releasedAt", "releaseReason");
    }

    @Test
    void projectionCommandPreservesExistingAndMultipleSameWeekLines() {
        Fixture fixture = fixture(activeMember(), activeLease());
        String path = "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w1";
        fixture.documents.put(path, new LinkedHashMap<>(Map.of(
            "id", "project-a-2026-07-w1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "weekNo", 1,
            "projection", new LinkedHashMap<>(Map.of("BANK_INTEREST_IN", 7L))
        )));

        UpsertProjectionResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).upsertProjection(
            ACTOR,
            "project-a",
            SESSION,
            new UpsertProjectionRequest("projection-same-week-merge", List.of(
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07", 1, "SALES_IN", BigDecimal.valueOf(2_300_000)
                ),
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07", 1, "MYSC_LABOR_OUT", BigDecimal.valueOf(300_000)
                )
            ))
        ));

        assertThat(response.savedLineCount()).isEqualTo(2);
        assertThat((Map<String, Object>) fixture.documents.get(path).get("projection"))
            .containsEntry("BANK_INTEREST_IN", 7L)
            .containsEntry("SALES_IN", 2_300_000L)
            .containsEntry("MYSC_LABOR_OUT", 300_000L);
    }

    @Test
    void projectionCommandPersistsAnExplicitZeroForAPreviouslyMissingLine() {
        Fixture fixture = fixture(activeMember(), activeLease());

        UpsertProjectionResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).upsertProjection(
            ACTOR,
            "project-a",
            SESSION,
            new UpsertProjectionRequest("projection-explicit-zero", List.of(
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07", 3, "MYSC_LABOR_OUT", BigDecimal.ZERO
                )
            ))
        ));

        assertThat(response.savedLineCount()).isEqualTo(1);
        assertThat((Map<String, Object>) fixture.documents.get(
            "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w3"
        ).get("projection"))
            .containsEntry("MYSC_LABOR_OUT", 0L);
    }

    @Test
    void lockedNoOpProjectionDoesNotBlockAChangedOpenWeekInTheSameCommand() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w3",
            new LinkedHashMap<>(Map.of(
                "id", "project-a-2026-07-w3",
                "tenantId", "tenant-a",
                "projectId", "project-a",
                "yearMonth", "2026-07",
                "weekNo", 3,
                "projection", Map.of("SALES_IN", 100L)
            ))
        );
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 1)
        );

        UpsertProjectionResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).upsertProjection(
            ACTOR,
            "project-a",
            SESSION,
            new UpsertProjectionRequest("locked-noop-open-change", List.of(
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07", 3, "SALES_IN", BigDecimal.valueOf(100)
                ),
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07", 4, "SALES_IN", BigDecimal.valueOf(200)
                )
            ))
        ));

        assertThat(response.savedLineCount()).isEqualTo(1);
        assertThat((Map<String, Object>) fixture.documents.get(
            "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w4"
        ).get("projection"))
            .containsEntry("SALES_IN", 200L);
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
    void allowsAssignedViewerToUseCashflowLeaseForSheetApplyAuthorization() {
        Fixture fixture = fixture(
            member(Map.of("role", "viewer", "projectIds", List.of("project-a"))),
            activeLease()
        );

        assertThat(fixture.persistence.runCommandTransaction(() ->
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION)
        )).isEqualTo("viewer");
    }

    @Test
    void allowsActiveDesignatedOrganizationHeadForMonthCloseWithoutOpeningGeneralWrites() {
        Fixture fixture = fixture(
            member(Map.of("role", "viewer", "projectIds", List.of())),
            activeLease()
        );
        fixture.documents.put("orgs/tenant-a/projects/project-a", Map.of(
            "id", "project-a",
            "tenantId", "tenant-a",
            "executiveApproverId", "pm-1"
        ));

        assertThat(fixture.persistence.runCommandTransaction(() ->
            fixture.persistence.requireCashflowMonthClosePermission(ACTOR, "project-a")
        )).isEqualTo("viewer");

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() ->
            fixture.persistence.requireCashflowWritePermission(ACTOR, "project-a")
        ))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
            .isEqualTo(403);
    }

    @Test
    void rejectsInactiveDesignatedOrganizationHeadForMonthClose() {
        Fixture fixture = fixture(
            member(Map.of("role", "viewer", "status", "INACTIVE", "projectIds", List.of())),
            activeLease()
        );
        fixture.documents.put("orgs/tenant-a/projects/project-a", Map.of(
            "id", "project-a",
            "tenantId", "tenant-a",
            "executiveApproverId", "pm-1"
        ));

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() ->
            fixture.persistence.requireCashflowMonthClosePermission(ACTOR, "project-a")
        ))
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
    void everyCashflowWeekWriterFailsClosedWithoutValidatedWritePermission() {
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
                org.assertj.core.api.Assertions.assertThat(lease.code()).isEqualTo("cashflow_write_scope_mismatch");
            });
    }

    @Test
    void validatedLegacyLeaseScopeDoesNotCreateWritePermissionInTheNextTransaction() {
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
            "actual", Map.of("DIRECT_COST_OUT", 60L),
            "weeklyExpenseActualBySheet", Map.of(
                "z-source", Map.of("DIRECT_COST_OUT", 10L),
                "A_source", Map.of("DIRECT_COST_OUT", 20L),
                "_source", Map.of("DIRECT_COST_OUT", 30L)
            ),
            "adminClosed", false
        )))).isEqualTo("sha256:013247d9be20befa6593d6a8dc9c39d3a39456651513458be7391d3aafc5383f");
    }

    @Test
    void targetRevisionChangesWhenActualSourceProvenanceChangesButAggregateDoesNot() {
        Map<String, Object> first = new LinkedHashMap<>();
        first.put("yearMonth", "2026-07");
        first.put("weekNo", 1);
        first.put("actual", Map.of("SALES_IN", 600L));
        first.put("weeklyExpenseActualBySheet", Map.of(
            "bank", Map.of("SALES_IN", 500L),
            "cashflow-sheet-lab", Map.of("SALES_IN", 100L)
        ));
        Map<String, Object> second = new LinkedHashMap<>(first);
        second.put("weeklyExpenseActualBySheet", Map.of(
            "bank", Map.of("SALES_IN", 400L),
            "cashflow-sheet-lab", Map.of("SALES_IN", 200L)
        ));

        assertThat(FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of(first)))
            .isNotEqualTo(FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of(second)));
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
        String mirrorPath = "orgs/tenant-a/cashflow_sheet_mirrors/project-a";
        fixture.documents.put(mirrorPath, new LinkedHashMap<>(Map.of(
            "projectId", "project-a",
            "status", "FRESH",
            "sourceRevision", SOURCE_REVISION,
            "targetRevisionAtFetch", targetRevision
        )));

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
        assertThat(fixture.documents.get(mirrorPath))
            .containsEntry("sourceRevision", SOURCE_REVISION)
            .containsEntry("targetRevisionAtFetch", response.resultingTargetRevision())
            .containsEntry("targetRevisionUpdateSource", "JVM_CANONICAL_APPLY");
        verify(fixture.transaction, never()).get(argThat((DocumentReference ref) ->
            ref.getPath().startsWith("orgs/tenant-a/cashflow_weeks/")
        ));
        verify(fixture.transaction).getAll(
            argThat(ref -> ref.getPath().endsWith("-w1")),
            argThat(ref -> ref.getPath().endsWith("-w2")),
            argThat(ref -> ref.getPath().endsWith("-w3")),
            argThat(ref -> ref.getPath().endsWith("-w4")),
            argThat(ref -> ref.getPath().endsWith("-w5"))
        );
    }

    @Test
    void fullYearApplySortsMonthsAndReadsAllSixtyWeeksInOneCommandTransaction() {
        Fixture fixture = fixture(activeMember(), activeLease());
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        List<CashflowSheetBatchApplyRequest.Month> requestedMonths = new ArrayList<>();
        List<String> expectedMonths = new ArrayList<>();
        for (int month = 12; month >= 1; month -= 1) {
            String yearMonth = "2026-" + String.format("%02d", month);
            CashflowSheetLabApplyRequest monthly = monthlyRequest(
                "month-" + month,
                targetRevision,
                yearMonth,
                ""
            );
            requestedMonths.add(new CashflowSheetBatchApplyRequest.Month(
                yearMonth, monthly.calculationChecks(), monthly.cells()
            ));
            expectedMonths.addFirst(yearMonth);
        }
        CashflowSheetBatchApplyRequest request = new CashflowSheetBatchApplyRequest(
            "batch-full-year",
            SOURCE_REVISION,
            targetRevision,
            false,
            null,
            null,
            openingBalanceCells(),
            requestedMonths
        );

        CashflowSheetBatchApplyResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetBatch(ACTOR, "project-a", SESSION, request));

        assertThat(response.months()).extracting(CashflowSheetBatchApplyResponse.MonthResult::yearMonth)
            .containsExactlyElementsOf(expectedMonths);
        assertThat(response.months().get(1).calculationChecks())
            .filteredOn(check -> check.mode().equals("projection") && check.weekNo() == 1)
            .singleElement()
            .satisfies(check -> assertThat(check.calculated().openingBalance()).isEqualByComparingTo("1999000"));
        assertThat(response.savedProjectionLineCount()).isEqualTo(960);
        assertThat(response.savedActualLineCount()).isEqualTo(960);
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/cashflow_weeks/project-a-2026-")))
            .hasSize(60);
        assertThat(fixture.getAllSizes).containsExactly(60);
        verify(fixture.collections.get("orgs/tenant-a/cashflow_weeks"), times(1))
            .whereEqualTo("projectId", "project-a");
        verify(fixture.transaction, times(1)).get(any(Query.class));
    }

    @Test
    void multiMonthApplyAmendsAClosedMonthBeforeItsDeadlineWithoutAWarning() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-08", Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-08",
            "status", "CLOSED",
            "revision", 1L,
            "reopenCount", 0L,
            "snapshotHash", "sha256:" + "f".repeat(64)
        ));
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        CashflowSheetLabApplyRequest july = monthlyRequest("july-source", targetRevision, "2026-07", "");
        CashflowSheetLabApplyRequest august = monthlyRequest("august-source", targetRevision, "2026-08", "");
        CashflowSheetBatchApplyRequest request = new CashflowSheetBatchApplyRequest(
            "batch-with-closed-august",
            SOURCE_REVISION,
            targetRevision,
            false,
            List.of(
                new CashflowSheetBatchApplyRequest.Month("2026-07", july.calculationChecks(), july.cells()),
                new CashflowSheetBatchApplyRequest.Month("2026-08", august.calculationChecks(), august.cells())
            )
        );

        CashflowSheetBatchApplyResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetBatch(ACTOR, "project-a", SESSION, request));

        assertThat(response.months()).extracting(CashflowSheetBatchApplyResponse.MonthResult::yearMonth)
            .containsExactly("2026-07", "2026-08");
        assertThat(fixture.documents.get("orgs/tenant-a/monthly_closes/project-a-2026-08"))
            .containsEntry("revision", 2L)
            .containsEntry("amendmentCount", 1L)
            .containsEntry("postDeadlineAmendmentWarningCount", 0L)
            .containsEntry("lastAmendmentPostDeadline", false);
        assertThat(fixture.documents.keySet()).anyMatch(path -> path.contains("/cashflow_month_amendments/"));
    }

    @Test
    void multiMonthApplyReportsEveryLateClosedMonthAndRecordsEachOnce() {
        Fixture fixture = fixture(activeMember(), activeLease(), true, LocalDate.parse("2026-10-11"));
        fixture.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-07", Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "status", "CLOSED",
            "revision", 1L,
            "reopenCount", 0L,
            "snapshotHash", "sha256:" + "f".repeat(64)
        ));
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 1)
        );
        fixture.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-08", Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-08",
            "status", "CLOSED",
            "revision", 1L,
            "reopenCount", 0L,
            "snapshotHash", "sha256:" + "e".repeat(64)
        ));
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        CashflowSheetLabApplyRequest july = monthlyRequest("batch-late-july", targetRevision, "2026-07", "");
        CashflowSheetLabApplyRequest august = monthlyRequest("batch-late-august", targetRevision, "2026-08", "");
        List<CashflowSheetBatchApplyRequest.Month> months = List.of(
            new CashflowSheetBatchApplyRequest.Month("2026-07", july.calculationChecks(), july.cells()),
            new CashflowSheetBatchApplyRequest.Month("2026-08", august.calculationChecks(), august.cells())
        );
        CashflowSheetBatchApplyRequest withoutReason = new CashflowSheetBatchApplyRequest(
            "batch-late-no-reason", SOURCE_REVISION, targetRevision, false, null, months
        );

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetBatch(ACTOR, "project-a", SESSION, withoutReason)))
            .isInstanceOfSatisfying(WeeklyExpenseEditLeaseException.class, error -> {
                assertThat(error.statusCode()).isEqualTo(409);
                assertThat(error.code()).isEqualTo("cashflow_closed_month_reason_required");
                assertThat(error.details().get("closedMonths"))
                    .isEqualTo(List.of("2026-07", "2026-08"));
            });
        assertThat(fixture.documents.keySet()).noneMatch(path -> path.contains("/cashflow_weeks/"));
        assertThat(fixture.documents.keySet()).noneMatch(path -> path.contains("/cashflow_month_amendments/"));

        CashflowSheetBatchApplyRequest corrected = new CashflowSheetBatchApplyRequest(
            "batch-late-with-reason",
            SOURCE_REVISION,
            targetRevision,
            false,
            "결산 후 다중 월 입금액 정정",
            months
        );
        WeeklyExpenseCommandService service = commandService(fixture.persistence);
        CashflowSheetBatchApplyResponse first = fixture.persistence.runCommandTransaction(() ->
            service.applyCashflowSheetBatch(ACTOR, "project-a", SESSION, corrected)
        );
        CashflowSheetBatchApplyResponse replay = fixture.persistence.runCommandTransaction(() ->
            service.applyCashflowSheetBatch(ACTOR, "project-a", SESSION, corrected)
        );

        assertThat(replay).isEqualTo(first);
        assertThat(fixture.documents.get("orgs/tenant-a/monthly_closes/project-a-2026-07"))
            .containsEntry("amendmentCount", 1L)
            .containsEntry("postDeadlineAmendmentWarningCount", 1L)
            .containsEntry("lastAmendmentReason", "결산 후 다중 월 입금액 정정");
        assertThat(fixture.documents.get("orgs/tenant-a/monthly_closes/project-a-2026-08"))
            .containsEntry("amendmentCount", 1L)
            .containsEntry("postDeadlineAmendmentWarningCount", 1L)
            .containsEntry("lastAmendmentReason", "결산 후 다중 월 입금액 정정");
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/cashflow_month_amendments/")))
            .hasSize(2);
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/weekly_api_audit_events/")))
            .hasSize(1);
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/cashflow_weeks/project-a-2026-")))
            .hasSize(10);
    }

    @Test
    void sheetBatchDoesNotTreatAReopenRequestAsAClosedMonthAmendment() {
        Fixture fixture = fixture(activeMember(), activeLease(), true, LocalDate.parse("2026-08-11"));
        fixture.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-07", Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "status", "REOPEN_REQUESTED",
            "revision", 2L,
            "reopenCount", 0L
        ));
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        CashflowSheetLabApplyRequest july = monthlyRequest("batch-reopen-requested", targetRevision, "2026-07", "");
        CashflowSheetBatchApplyRequest request = new CashflowSheetBatchApplyRequest(
            "batch-reopen-requested",
            SOURCE_REVISION,
            targetRevision,
            false,
            "승인 전 변경 시도",
            List.of(new CashflowSheetBatchApplyRequest.Month(
                "2026-07", july.calculationChecks(), july.cells()
            ))
        );

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetBatch(ACTOR, "project-a", SESSION, request)))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("closed");
        assertThat(fixture.documents.keySet()).noneMatch(path -> path.contains("/cashflow_weeks/"));
        assertThat(fixture.documents.keySet()).noneMatch(path -> path.contains("/cashflow_month_amendments/"));
        assertThat(fixture.documents.keySet()).noneMatch(path -> path.contains("/weekly_api_audit_events/"));
    }

    @Test
    void annualTotalWriteDoesNotRequireAMonthKey() {
        Fixture fixture = fixture(activeMember(), activeLease());
        CashflowSheetAnnualApplyRequest request = new CashflowSheetAnnualApplyRequest(
            "annual-2025",
            SOURCE_REVISION,
            2025,
            0,
            annualCells()
        );

        fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWritePermission(ACTOR, "project-a");
            fixture.persistence.replaceCashflowSheetYearTotal(
                "tenant-a",
                "project-a",
                "cashflow-sheet-lab",
                request
            );
            return null;
        });

        assertThat(fixture.documents.values()).anySatisfy(document -> assertThat(document)
            .containsEntry("projectId", "project-a")
            .containsEntry("year", 2025)
            .doesNotContainKey("yearMonth"));
        assertThat(fixture.persistence.findCashflowSheetYearTotals("tenant-a", "project-a"))
            .singleElement()
            .satisfies(total -> {
                assertThat(total.year()).isEqualTo(2025);
                assertThat(total.projection()).isEmpty();
                assertThat(total.actual()).isEmpty();
                assertThat(total.projectionStates()).containsEntry("MYSC_PREPAY_IN", "EMPTY");
                assertThat(total.actualStates()).containsEntry("MYSC_PREPAY_IN", "EMPTY");
            });
    }

    @Test
    void annualTotalWritePreservesExplicitZeroAsARowValueAndState() {
        Fixture fixture = fixture(activeMember(), activeLease());
        List<CashflowSheetAnnualApplyRequest.Cell> cells = annualCells().stream()
            .map(cell -> "projection".equals(cell.mode()) && "SALES_IN".equals(cell.cashflowLine())
                ? new CashflowSheetAnnualApplyRequest.Cell(
                    cell.mode(), cell.cashflowLine(), "ZERO", BigDecimal.ZERO, "A1", cell.sourceLabel()
                )
                : cell)
            .toList();
        CashflowSheetAnnualApplyRequest request = new CashflowSheetAnnualApplyRequest(
            "annual-zero-2025",
            SOURCE_REVISION,
            2025,
            0,
            cells
        );

        fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWritePermission(ACTOR, "project-a");
            fixture.persistence.replaceCashflowSheetYearTotal(
                "tenant-a", "project-a", "cashflow-sheet-lab", request
            );
            return null;
        });

        assertThat(fixture.persistence.findCashflowSheetYearTotals("tenant-a", "project-a"))
            .singleElement()
            .satisfies(total -> {
                assertThat(total.projection()).containsEntry("SALES_IN", BigDecimal.ZERO);
                assertThat(total.projectionStates()).containsEntry("SALES_IN", "ZERO");
            });
    }

    @Test
    void monthlyApplyRejectsTargetDriftAndAmendsAClosedMonthBeforeItsDeadline() {
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

        Fixture legacyClosed = fixture(activeMember(), activeLease());
        legacyClosed.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-07", Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "status", "CLOSED",
            "revision", 1L,
            "reopenCount", 0L
        ));
        assertThatThrownBy(() -> legacyClosed.persistence.runCommandTransaction(() -> commandService(
            legacyClosed.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest(
                "monthly-legacy-closed",
                "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44",
                ""
            )
        ))).isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("snapshot hash");
        assertThat(legacyClosed.documents.keySet()).noneMatch(path -> path.contains("cashflow_weeks"));

        Fixture closed = fixture(activeMember(), activeLease());
        closed.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-07", Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "status", "CLOSED",
            "revision", 1L,
            "reopenCount", 0L,
            "snapshotHash", "sha256:" + "f".repeat(64)
        ));
        CashflowSheetLabApplyResponse closedResponse = closed.persistence.runCommandTransaction(() -> commandService(
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
        ));
        assertThat(closedResponse.yearMonth()).isEqualTo("2026-07");
        assertThat(closedResponse.calculationChecks())
            .filteredOn(check -> check.mode().equals("projection") && check.weekNo() == 1)
            .singleElement()
            .satisfies(check -> {
                assertThat(check.reported().depositTotal()).isEqualByComparingTo("800");
                assertThat(check.calculated().depositTotal()).isEqualByComparingTo("700");
                assertThat(check.calculated().withdrawalTotal()).isEqualByComparingTo("900");
                assertThat(check.matches().depositTotal()).isFalse();
            });
        assertThat(closed.documents.get("orgs/tenant-a/monthly_closes/project-a-2026-07"))
            .containsEntry("revision", 2L)
            .containsEntry("amendmentCount", 1L)
            .containsEntry("postDeadlineAmendmentWarningCount", 0L)
            .hasEntrySatisfying("lastAmendmentEvidence", value -> {
                Map<String, Object> evidence = (Map<String, Object>) value;
                assertThat(evidence)
                    .containsEntry("closeRevision", 1L)
                    .containsEntry("resultingCloseRevision", 2L)
                    .containsEntry("closeSnapshotHash", "sha256:" + "f".repeat(64))
                    .containsEntry("sourceRevision", SOURCE_REVISION)
                    .containsEntry("targetRevision", "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44");
                assertThat((List<?>) evidence.get("calculationChecks")).hasSize(10);
            });
    }

    @Test
    void postDeadlineClosedMonthSheetChangeRequiresReasonAndRecordsOneWarning() {
        Fixture fixture = fixture(activeMember(), activeLease(), true, LocalDate.parse("2026-08-11"));
        fixture.documents.put("orgs/tenant-a/monthly_closes/project-a-2026-07", Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "status", "CLOSED",
            "revision", 1L,
            "reopenCount", 0L,
            "snapshotHash", "sha256:" + "d".repeat(64)
        ));
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 1)
        );
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        CashflowSheetLabApplyRequest base = monthlyRequest("late-no-reason", targetRevision, "");

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(ACTOR, "project-a", SESSION, base)))
            .isInstanceOfSatisfying(WeeklyExpenseEditLeaseException.class, error -> {
                assertThat(error.statusCode()).isEqualTo(409);
                assertThat(error.code()).isEqualTo("cashflow_closed_month_reason_required");
            });
        assertThat(fixture.documents.keySet()).noneMatch(path -> path.contains("/cashflow_weeks/"));

        CashflowSheetLabApplyRequest corrected = new CashflowSheetLabApplyRequest(
            "late-with-reason", base.sourceRevision(), base.targetRevision(), base.yearMonth(),
            base.replaceAllActualSources(), null, "결산 후 실제 입금액 정정",
            base.calculationChecks(), base.cells()
        );
        fixture.persistence.runCommandTransaction(() -> commandService(fixture.persistence)
            .applyCashflowSheetLab(ACTOR, "project-a", SESSION, corrected));
        fixture.persistence.runCommandTransaction(() -> commandService(fixture.persistence)
            .applyCashflowSheetLab(ACTOR, "project-a", SESSION, corrected));

        assertThat(fixture.documents.get("orgs/tenant-a/monthly_closes/project-a-2026-07"))
            .containsEntry("amendmentCount", 1L)
            .containsEntry("postDeadlineAmendmentWarningCount", 1L)
            .containsEntry("lastAmendmentReason", "결산 후 실제 입금액 정정");
        assertThat(fixture.documents.keySet()).anyMatch(path -> path.contains("/cashflow_month_amendments/"));
        CashflowMonthCloseResponse close = commandService(fixture.persistence)
            .readCashflowMonthClose(READ_ACTOR, "project-a", "2026-07");
        assertThat(close.amendmentCount()).isEqualTo(1L);
        assertThat(close.postDeadlineAmendmentWarningCount()).isEqualTo(1L);
        assertThat(close.projectWarningCount()).isEqualTo(1L);
        assertThat(close.lastAmendmentReason()).isEqualTo("결산 후 실제 입금액 정정");
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
    void monthlyApplyRejectsCanonicalIdsWithMissingOrMismatchedProjectMetadata() {
        List<Map<String, Object>> malformedWeeks = new ArrayList<>();
        Map<String, Object> missingProject = draftWeek();
        missingProject.remove("projectId");
        malformedWeeks.add(missingProject);
        Map<String, Object> mismatchedProject = draftWeek();
        mismatchedProject.put("projectId", "project-b");
        malformedWeeks.add(mismatchedProject);

        for (int index = 0; index < malformedWeeks.size(); index += 1) {
            Fixture fixture = fixture(activeMember(), activeLease());
            Map<String, Object> malformedWeek = malformedWeeks.get(index);
            String idempotencyKey = "monthly-project-metadata-" + index;
            fixture.documents.put(weekPath(), malformedWeek);

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
                fixture.persistence
            ).applyCashflowSheetLab(
                ACTOR,
                "project-a",
                SESSION,
                monthlyRequest(
                    idempotencyKey,
                    "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44",
                    ""
                )
            )))
                .isInstanceOf(WeeklyExpenseConflictException.class)
                .hasMessageContaining("migration");

            assertThat(fixture.documents.get(weekPath())).isEqualTo(malformedWeek);
        }
    }

    @Test
    void monthlyApplyRejectsCanonicalIdsWithFractionalWeekNumbers() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> malformedWeek = draftWeek();
        malformedWeek.put("weekNo", 1.5d);
        fixture.documents.put(weekPath(), malformedWeek);
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(
            List.of(malformedWeek)
        );

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest("monthly-fractional-week", targetRevision, "")
        )))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("migration");

        assertThat(fixture.documents.get(weekPath())).isEqualTo(malformedWeek);
    }

    @Test
    void monthlyApplyRejectsExistingNonCanonicalCashflowAmounts() {
        List<Map<String, Object>> malformedWeeks = new ArrayList<>();
        Map<String, Object> stringProjection = draftWeek();
        stringProjection.put("projection", Map.of("SALES_IN", "100"));
        malformedWeeks.add(stringProjection);
        Map<String, Object> stringActual = draftWeek();
        stringActual.put("actual", Map.of("SALES_IN", "100"));
        malformedWeeks.add(stringActual);
        Map<String, Object> stringActualSource = draftWeek();
        stringActualSource.put("weeklyExpenseActualBySheet", Map.of(
            "bank-import", Map.of("SALES_IN", "100")
        ));
        malformedWeeks.add(stringActualSource);
        Map<String, Object> fractionalProjection = draftWeek();
        fractionalProjection.put("projection", Map.of("SALES_IN", 1.5d));
        malformedWeeks.add(fractionalProjection);
        Map<String, Object> overflowingActual = draftWeek();
        overflowingActual.put("actual", Map.of("SALES_IN", new BigDecimal("9223372036854775808")));
        malformedWeeks.add(overflowingActual);

        for (int index = 0; index < malformedWeeks.size(); index += 1) {
            Fixture fixture = fixture(activeMember(), activeLease());
            Map<String, Object> malformedWeek = malformedWeeks.get(index);
            String idempotencyKey = "monthly-non-numeric-" + index;
            fixture.documents.put(weekPath(), malformedWeek);
            String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(
                List.of(malformedWeek)
            );

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
                fixture.persistence
            ).applyCashflowSheetLab(
                ACTOR,
                "project-a",
                SESSION,
                monthlyRequest(idempotencyKey, targetRevision, "")
            )))
                .isInstanceOf(WeeklyExpenseConflictException.class)
                .hasMessageContaining("migration");

            assertThat(fixture.documents.get(weekPath())).isEqualTo(malformedWeek);
        }
    }

    @Test
    void exactReplayReturnsWithoutChangingAnExistingLease() {
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
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "ACTIVE")
            .doesNotContainKeys("releasedAt", "releaseReason");
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
        assertThat(fixture.persistence.findCashflowWeeklyYears("tenant-a", "project-a"))
            .containsExactly(2026);
    }

    @Test
    void dashboardLedgerSourceDerivesProjectionActualAndYearsFromOneFirestoreQuery() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weeks/project-a-2025-12-w5",
            new LinkedHashMap<>(Map.of(
                "tenantId", "tenant-a",
                "projectId", "project-a",
                "yearMonth", "2025-12",
                "weekNo", 5,
                "projection", Map.of("SALES_IN", 2_000_000L),
                "weeklyExpenseActualBySheet", Map.of(
                    "cashflow-sheet-lab",
                    Map.of("SALES_IN", 1_800_000L)
                )
            ))
        );

        WeeklyExpensePersistence.CashflowLedgerSource source = fixture.persistence
            .findCashflowLedgerSource("tenant-a", "project-a");

        assertThat(source.weeklyYears()).containsExactly(2025);
        assertThat(source.projection()).singleElement().satisfies(line ->
            assertThat(line.getAmount()).isEqualByComparingTo("2000000")
        );
        assertThat(source.actual()).singleElement().satisfies(line ->
            assertThat(line.getAmount()).isEqualByComparingTo("1800000")
        );
        verify(fixture.collections.get("orgs/tenant-a/cashflow_weeks"), times(1))
            .whereEqualTo("projectId", "project-a");
    }

    @Test
    void monthCloseAtomicallyPersistsCanonicalValuesAndSnapshotWithoutLease() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-1", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_sheet_mirrors/project-a",
            pinnedMirror(request)
        );
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-06-w3",
            lockedWeeklyCompletion("2026-06", 3, 1)
        );
        WeeklyExpenseCommandService service = commandService(fixture.persistence);

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> service.closeCashflowMonth(
            ACTOR,
            "project-a",
            SESSION,
            request
        ));
        CashflowMonthCloseResponse replay = fixture.persistence.runCommandTransaction(() -> service.closeCashflowMonth(
            ACTOR,
            "project-a",
            SESSION,
            request
        ));

        Map<String, Object> close = fixture.documents.get(monthClosePath("project-a", "2026-06"));
        Map<String, Object> closeVersion = fixture.documents.get(monthCloseVersionPath("project-a", "2026-06", 1));
        assertThat(response.status()).isEqualTo("CLOSED");
        assertThat(response.revision()).isEqualTo(1);
        assertThat(response.reopenCount()).isZero();
        assertThat(replay.status()).isEqualTo(response.status());
        assertThat(replay.revision()).isEqualTo(response.revision());
        assertThat(replay.snapshotHash()).isEqualTo(response.snapshotHash());
        assertThat(replay.auditId()).isEqualTo(response.auditId());
        assertThat(response.snapshotHash()).startsWith("sha256:");
        assertThat(close)
            .containsEntry("status", "CLOSED")
            .containsEntry("revision", 1L)
            .containsEntry("reopenCount", 0L)
            .containsEntry("amendmentCount", 0)
            .containsEntry("postDeadlineAmendmentWarningCount", 0)
            .containsEntry("lastAmendmentEvidence", Map.of())
            .containsEntry("snapshotHash", response.snapshotHash())
            .containsKeys("snapshot", "closedAt", "closedByUid");
        assertThat((Map<String, Object>) close.get("snapshot"))
            .containsEntry("sourceFingerprint", SOURCE_REVISION)
            .containsEntry("sourceReadAt", NOW.minusSeconds(120).toString())
            .containsEntry("draftRevision", 3L)
            .hasEntrySatisfying("draftInputHash", value -> assertThat(value).asString().startsWith("sha256:"))
            .containsKeys(
                "project", "sheetFacts", "depositScheduleRows", "confirmations",
                "managementChecks", "managementConfirmations", "deadlineSummary",
                "openingBalances", "cells", "weeklyTotals", "projectionTotal", "actualTotal"
            );
        assertThat((List<Map<String, Object>>) ((Map<String, Object>) close.get("snapshot")).get("cells"))
            .hasSize(CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT)
            .allSatisfy(cell -> assertThat(cell).containsEntry("cellState", "VALUE"));
        assertThat(closeVersion)
            .containsEntry("projectId", "project-a")
            .containsEntry("yearMonth", "2026-06")
            .containsEntry("revision", 1L)
            .containsEntry("snapshotHash", response.snapshotHash())
            .containsKeys("snapshot", "closedAt", "closedByUid");
        assertThat(response.previousSnapshot()).isEmpty();
        assertThat((List<?>) ((Map<String, Object>) close.get("snapshot")).get("depositScheduleRows"))
            .hasSize(5);
        assertThat(fixture.documents.get("orgs/tenant-a/cashflow_weeks/project-a-2026-06-w1"))
            .containsKeys("projection", "actual")
            .containsEntry("yearMonth", "2026-06");
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "ACTIVE")
            .doesNotContainKeys("releasedAt", "releaseReason");
        assertThat(fixture.documents.keySet())
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_audit_events/"))
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_idempotency/"));
    }

    @Test
    void monthCloseRejectsAnApplyingSheetPublicationInsideTheFirestoreTransaction() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-publication-applying", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_sheet_publications/project-a",
            new LinkedHashMap<>(Map.of(
                "projectId", "project-a",
                "status", "APPLYING",
                "stagedRunId", "annual-only-stage-run",
                "sourceRevision", SOURCE_REVISION
            ))
        );
        fixture.documents.put(
            "orgs/tenant-a/cashflow_sheet_mirrors/project-a",
            pinnedMirror(request)
        );

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request)))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("being applied");

        verify(fixture.transaction).get(
            fixture.refs.get("orgs/tenant-a/cashflow_sheet_publications/project-a")
        );
        assertThat(fixture.documents).doesNotContainKey(monthClosePath("project-a", request.yearMonth()));
        assertThat(fixture.documents.keySet()).noneMatch(path ->
            path.startsWith("orgs/tenant-a/cashflow_month_close_versions/")
        );
    }

    @Test
    @SuppressWarnings("unchecked")
    void monthCloseTransactionRetriesAndRejectsAnAnnualOnlyPublicationReservedAfterItsFirstRead() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-publication-race", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        String publicationPath = "orgs/tenant-a/cashflow_sheet_publications/project-a";
        fixture.documents.put(publicationPath, new LinkedHashMap<>(Map.of(
            "projectId", "project-a",
            "status", "READY"
        )));
        fixture.documents.put(
            "orgs/tenant-a/cashflow_sheet_mirrors/project-a",
            pinnedMirror(request)
        );

        when(fixture.db.runTransaction(any())).thenAnswer(invocation -> {
            Transaction.Function<Object> callback = invocation.getArgument(0);
            fixture.pendingWrites.clear();
            try {
                callback.updateCallback(fixture.transaction);
                fixture.pendingWrites.clear();
                fixture.documents.put(publicationPath, new LinkedHashMap<>(Map.of(
                    "projectId", "project-a",
                    "status", "APPLYING",
                    "stagedRunId", "annual-only-race",
                    "sourceScope", "ANNUAL",
                    "sourceRevision", SOURCE_REVISION
                )));
                Object retried = callback.updateCallback(fixture.transaction);
                for (PendingWrite write : fixture.pendingWrites) {
                    Map<String, Object> document = write.merge()
                        ? new LinkedHashMap<>(fixture.documents.getOrDefault(write.ref().getPath(), Map.of()))
                        : new LinkedHashMap<>();
                    document.putAll(write.data());
                    fixture.documents.put(write.ref().getPath(), document);
                }
                fixture.pendingWrites.clear();
                return ApiFutures.immediateFuture(retried);
            } catch (Throwable error) {
                fixture.pendingWrites.clear();
                return ApiFutures.immediateFailedFuture(error);
            }
        });

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request)))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("being applied");

        verify(fixture.transaction, times(2)).get(fixture.refs.get(publicationPath));
        assertThat(fixture.documents).doesNotContainKey(monthClosePath("project-a", request.yearMonth()));
        assertThat(fixture.documents.keySet()).noneMatch(path ->
            path.startsWith("orgs/tenant-a/cashflow_month_close_versions/")
        );
    }

    @Test
    void weeklyCashflowCompletionLocksTheCurrentLedgerSnapshotAndKeepsItsFirstActor() {
        Fixture fixture = fixture(activeMember(), Map.of());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w3",
            new LinkedHashMap<>(Map.of(
                "id", "project-a-2026-07-w3",
                "tenantId", "tenant-a",
                "projectId", "project-a",
                "yearMonth", "2026-07",
                "weekNo", 3,
                "projection", Map.of("SALES_IN", 100L),
                "actual", Map.of("SALES_IN", 90L)
            ))
        );
        fixture.documents.put(
            "orgs/tenant-a/cashflow_sheet_mirrors/project-a",
            Map.of("projectId", "project-a", "sourceRevision", SOURCE_REVISION)
        );
        WeeklyExpenseCommandService service = commandService(fixture.persistence);
        CompleteCashflowWeeklyUpdateRequest firstRequest = new CompleteCashflowWeeklyUpdateRequest(
            "weekly-complete-1", "2026-07", 3, "2026-07-16T09:00:00Z"
        );
        CompleteCashflowWeeklyUpdateRequest secondRequest = new CompleteCashflowWeeklyUpdateRequest(
            "weekly-complete-2", "2026-07", 3, "2026-07-16T10:00:00Z"
        );

        CashflowWeeklyUpdateCompletionResponse first = fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(ACTOR, "project-a", firstRequest)
        );
        CashflowWeeklyUpdateCompletionResponse second = fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(ACTOR, "project-a", secondRequest)
        );
        CashflowWeeklyUpdateCompletionResponse read = fixture.persistence.runCommandTransaction(() ->
            service.readCashflowWeeklyUpdate(READ_ACTOR, "project-a", "2026-07", 3)
        );

        assertThat(first.alreadyCompleted()).isFalse();
        assertThat(second.alreadyCompleted()).isTrue();
        assertThat(second.completedAt()).isEqualTo(first.completedAt());
        assertThat(read.status()).isEqualTo("LOCKED");
        assertThat(read.snapshotHash()).isEqualTo(first.snapshotHash());
        assertThat(fixture.documents.get(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3"
        ))
            .containsEntry("projectId", "project-a")
            .containsEntry("yearMonth", "2026-07")
            .containsEntry("weekNo", 3)
            .containsEntry("status", "LOCKED")
            .containsEntry("revision", 1L)
            .containsEntry("sourceRevision", SOURCE_REVISION)
            .containsEntry("completedAt", "2026-07-16T09:00:00Z")
            .containsEntry("completedByUid", "pm-1")
            .satisfies(value -> assertThat(value.get("snapshotHash")).asString().startsWith("sha256:"))
            .satisfies(value -> assertThat(value.get("targetRevision")).asString().startsWith("sha256:"))
            .containsKey("snapshot");
        assertThat(fixture.documents.keySet())
            .anyMatch(path -> path.startsWith(
                "orgs/tenant-a/cashflow_weekly_update_completion_versions/project-a-2026-07-w3-r1"
            ));
    }

    @Test
    void weeklyCompletionRetryIgnoresRegeneratedTimestampButRejectsADifferentScope() {
        Fixture fixture = fixture(activeMember(), Map.of());
        WeeklyExpenseCommandService service = commandService(fixture.persistence);
        CompleteCashflowWeeklyUpdateRequest firstRequest = new CompleteCashflowWeeklyUpdateRequest(
            "weekly-retry-stable", "2026-07", 3, "2026-07-16T09:00:00Z"
        );
        CompleteCashflowWeeklyUpdateRequest retriedRequest = new CompleteCashflowWeeklyUpdateRequest(
            "weekly-retry-stable", "2026-07", 3, "2026-07-16T09:00:15Z"
        );

        CashflowWeeklyUpdateCompletionResponse first = fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(ACTOR, "project-a", firstRequest)
        );
        CashflowWeeklyUpdateCompletionResponse replay = fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(ACTOR, "project-a", retriedRequest)
        );

        assertThat(replay).isEqualTo(first);
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/cashflow_weekly_update_completion_versions/")))
            .hasSize(1);
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/weekly_api_audit_events/")))
            .hasSize(1);

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(
                ACTOR,
                "project-a",
                new CompleteCashflowWeeklyUpdateRequest(
                    "weekly-retry-stable", "2026-07", 4, "2026-07-16T09:00:30Z"
                )
            )
        ))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("Idempotency key");
    }

    @Test
    void weeklyLockReadRejectsCanonicalLedgerDrift() {
        Fixture fixture = fixture(activeMember(), Map.of());
        String path = "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w3";
        fixture.documents.put(path, new LinkedHashMap<>(Map.of(
            "id", "project-a-2026-07-w3",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "weekNo", 3,
            "projection", Map.of("SALES_IN", 100L),
            "actual", Map.of()
        )));
        WeeklyExpenseCommandService service = commandService(fixture.persistence);
        fixture.persistence.runCommandTransaction(() -> service.completeCashflowWeeklyUpdate(
            ACTOR,
            "project-a",
            new CompleteCashflowWeeklyUpdateRequest(
                "weekly-drift-lock", "2026-07", 3, "2026-07-16T09:00:00Z"
            )
        ));
        Map<String, Object> drifted = new LinkedHashMap<>(fixture.documents.get(path));
        drifted.put("projection", Map.of("SALES_IN", 999L));
        fixture.documents.put(path, drifted);

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() ->
            service.readCashflowWeeklyUpdate(READ_ACTOR, "project-a", "2026-07", 3)
        ))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("canonical ledger");
    }

    @Test
    void lockedCashflowWeekRemainsOperationalStatusWhileProjectionChanges() {
        Fixture fixture = fixture(activeMember(), Map.of());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w3",
            new LinkedHashMap<>(Map.of(
                "id", "project-a-2026-07-w3",
                "tenantId", "tenant-a",
                "projectId", "project-a",
                "yearMonth", "2026-07",
                "weekNo", 3,
                "projection", Map.of("SALES_IN", 100L),
                "actual", Map.of()
            ))
        );
        WeeklyExpenseCommandService service = commandService(fixture.persistence);
        CompleteCashflowWeeklyUpdateRequest lock = new CompleteCashflowWeeklyUpdateRequest(
            "weekly-lock-1", "2026-07", 3, "2026-07-16T09:00:00Z"
        );

        fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(ACTOR, "project-a", lock)
        );

        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> service.upsertProjection(
            ACTOR,
            "project-a",
            FINAL_SESSION,
            new UpsertProjectionRequest("projection-while-locked", List.of(
                new UpsertProjectionRequest.ProjectionLinePatch("2026-07", 3, "SALES_IN", BigDecimal.valueOf(200))
            ))
        ))).doesNotThrowAnyException();

        assertThat(fixture.documents.get("orgs/tenant-a/cashflow_weeks/project-a-2026-07-w3"))
            .hasEntrySatisfying("projection", value -> assertThat((Map<String, Object>) value)
                .containsEntry("SALES_IN", 200L));
        assertThat(fixture.documents.get(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3"
        )).containsEntry("status", "LOCKED");
    }

    @Test
    void aLockedWeekDoesNotBlockProjectionInAnotherWeek() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 1)
        );

        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).upsertProjection(
            ACTOR,
            "project-a",
            SESSION,
            new UpsertProjectionRequest("different-week", List.of(
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07", 4, "SALES_IN", BigDecimal.valueOf(200)
                )
            ))
        ))).doesNotThrowAnyException();

        assertThat(fixture.documents.get("orgs/tenant-a/cashflow_weeks/project-a-2026-07-w4"))
            .hasEntrySatisfying("projection", value -> assertThat((Map<String, Object>) value)
                .containsEntry("SALES_IN", 200L));
    }

    @Test
    void sheetApplyChangesASettledWeekWithoutWeeklyConfirmation() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 1)
        );
        String targetRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        CashflowSheetLabApplyResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            monthlyRequest("locked-sheet-apply", targetRevision, "")
        ));

        assertThat(response.settledWeekChanges()).isEmpty();
        assertThat(fixture.documents.keySet()).anyMatch(path -> path.contains("/cashflow_weeks/"));
        assertThat(fixture.documents.get(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3"
        ))
            .containsEntry("status", "LOCKED")
            .doesNotContainKeys("postSettlementChangeWarningCount", "lastPostSettlementChangeByUid");
        assertThat(fixture.documents.keySet())
            .noneMatch(path -> path.contains("/cashflow_weekly_settlement_change_warnings/"));
    }

    @Test
    void sheetApplySkipsAnUnchangedLockedWeekAndUpdatesOnlyTheChangedOpenWeek() {
        Fixture fixture = fixture(activeMember(), activeLease());
        String emptyRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        CashflowSheetLabApplyRequest initialRequest = monthlyRequest(
            "sheet-initial-before-week-lock",
            emptyRevision,
            ""
        );
        CashflowSheetLabApplyResponse initial = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(ACTOR, "project-a", SESSION, initialRequest));
        String lockedPath = "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w3";
        Map<String, Object> lockedBefore = new LinkedHashMap<>(fixture.documents.get(lockedPath));
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 1)
        );
        List<CashflowSheetLabApplyRequest.Cell> changedCells = initialRequest.cells().stream()
            .map(cell -> "projection".equals(cell.mode())
                && cell.weekNo() == 4
                && "SALES_IN".equals(cell.cashflowLine())
                    ? new CashflowSheetLabApplyRequest.Cell(
                        cell.mode(), cell.weekNo(), cell.cashflowLine(), "VALUE", BigDecimal.valueOf(101),
                        cell.sourceCell(), cell.sourceLabel()
                    )
                    : cell)
            .toList();
        CashflowSheetLabApplyRequest changedRequest = new CashflowSheetLabApplyRequest(
            "sheet-open-week-change",
            SOURCE_REVISION,
            initial.resultingTargetRevision(),
            "2026-07",
            false,
            null,
            null,
            initialRequest.calculationChecks(),
            changedCells
        );

        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(ACTOR, "project-a", SESSION, changedRequest)))
            .doesNotThrowAnyException();

        assertThat(fixture.documents.get(lockedPath)).isEqualTo(lockedBefore);
        assertThat((Map<String, Object>) fixture.documents.get(
            "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w4"
        ).get("projection"))
            .containsEntry("SALES_IN", 101L);
    }

    @Test
    void sheetApplyMaterializesAnAbsentAllEmptyWeekAndKeepsTargetRevisionStable() {
        Fixture fixture = fixture(activeMember(), activeLease());
        String emptyRevision = FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(List.of());
        CashflowSheetLabApplyRequest base = monthlyRequest("sheet-empty-week", emptyRevision, "");
        List<CashflowSheetLabApplyRequest.Cell> cells = base.cells().stream()
            .map(cell -> cell.weekNo() == 5
                ? new CashflowSheetLabApplyRequest.Cell(
                    cell.mode(), cell.weekNo(), cell.cashflowLine(), "EMPTY", null,
                    cell.sourceCell(), cell.sourceLabel()
                )
                : cell)
            .toList();
        CashflowSheetLabApplyRequest request = new CashflowSheetLabApplyRequest(
            base.idempotencyKey(),
            base.sourceRevision(),
            base.targetRevision(),
            base.yearMonth(),
            base.replaceAllActualSources(),
            null,
            null,
            base.calculationChecks(),
            cells
        );

        CashflowSheetLabApplyResponse first = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(ACTOR, "project-a", SESSION, request));
        String emptyWeekPath = "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w5";
        assertThat(fixture.documents).containsKey(emptyWeekPath);
        List<Map<String, Object>> persistedWeeks = fixture.documents.entrySet().stream()
            .filter(entry -> entry.getKey().startsWith("orgs/tenant-a/cashflow_weeks/project-a-2026-07-w"))
            .map(Map.Entry::getValue)
            .toList();
        assertThat(first.resultingTargetRevision()).isEqualTo(
            FirestoreInheritedWeeklyExpensePersistence.computeCashflowTargetRevision(persistedWeeks)
        );

        CashflowSheetLabApplyRequest replay = new CashflowSheetLabApplyRequest(
            "sheet-empty-week-replay",
            SOURCE_REVISION,
            first.resultingTargetRevision(),
            "2026-07",
            false,
            null,
            null,
            base.calculationChecks(),
            cells
        );
        CashflowSheetLabApplyResponse second = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).applyCashflowSheetLab(ACTOR, "project-a", SESSION, replay));
        assertThat(second.resultingTargetRevision()).isEqualTo(first.resultingTargetRevision());
    }

    @Test
    void weeklyExpenseActualReplacementIgnoresWeeklySettlementStatus() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(weekPath(), draftWeek());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w1",
            lockedWeeklyCompletion("2026-07", 1, 1)
        );

        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWritePermission(ACTOR, "project-a");
            fixture.persistence.replaceActualLines(
                "tenant-a",
                "project-a",
                "cashflow-sheet-lab",
                List.of(new SaveDraftResponse.ActualDelta(
                    "2026-07", 1, "SALES_IN", BigDecimal.valueOf(50)
                ))
            );
            return null;
        })).doesNotThrowAnyException();
        assertThat(fixture.documents.get(weekPath()))
            .hasEntrySatisfying("actual", value -> assertThat((Map<String, Object>) value)
                .containsEntry("SALES_IN", 50L));
    }

    @Test
    void weeklySheetActualReplacementIgnoresWeeklySettlementStatus() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(weekPath(), draftWeek());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w1",
            lockedWeeklyCompletion("2026-07", 1, 1)
        );
        WeeklyExpenseSheetEntity sheet = new WeeklyExpenseSheetEntity(
            "tenant-a", "project-a", "default", "Default"
        );

        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWritePermission(ACTOR, "project-a");
            fixture.persistence.replaceActuals(
                sheet,
                List.of(new SaveDraftResponse.ActualDelta(
                    "2026-07", 1, "SALES_IN", BigDecimal.valueOf(50)
                ))
            );
            return null;
        })).doesNotThrowAnyException();
        assertThat(fixture.documents.get(weekPath()))
            .hasEntrySatisfying("actual", value -> assertThat((Map<String, Object>) value)
                .containsEntry("SALES_IN", 50L));
    }

    @Test
    void submitAndCloseCommandsIgnoreWeeklySettlementStatus() {
        Fixture submitFixture = fixture(activeMember(), activeLease());
        submitFixture.documents.put(weekPath(), draftWeek());
        submitFixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w1",
            lockedWeeklyCompletion("2026-07", 1, 1)
        );

        assertThatCode(() -> submitFixture.persistence.runCommandTransaction(() -> commandService(
            submitFixture.persistence
        ).submitWeek(
            ACTOR,
            "project-a",
            SESSION,
            new SubmitWeekRequest("locked-submit", "2026-07", 1)
        ))).doesNotThrowAnyException();

        Fixture closeFixture = fixture(
            member(Map.of("role", "finance", "projectIds", List.of())),
            activeLease()
        );
        closeFixture.documents.put(weekPath(), submittedWeek());
        closeFixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w1",
            lockedWeeklyCompletion("2026-07", 1, 1)
        );

        assertThatCode(() -> closeFixture.persistence.runCommandTransaction(() -> commandService(
            closeFixture.persistence
        ).closeWeek(
            ACTOR,
            "project-a",
            SESSION,
            closeRequest("locked-close", BigDecimal.valueOf(100))
        ))).doesNotThrowAnyException();
    }

    @Test
    void submitWithASheetDoesNotReadWeeklySettlementAsAWriteGuard() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(weekPath(), draftWeek());
        SubmitWeekRequest request = new SubmitWeekRequest(
            "submit-read-before-write",
            "2026-07",
            1,
            new SubmitWeekRequest.WeeklySheetSnapshot("default", null, "Default", List.of())
        );

        fixture.persistence.runCommandTransaction(() -> commandService(fixture.persistence).submitWeek(
            ACTOR,
            "project-a",
            SESSION,
            request
        ));

        verify(fixture.transaction, never()).get(argThat((DocumentReference ref) -> ref.getPath().equals(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w1"
        )));
        verify(fixture.transaction).set(argThat((DocumentReference ref) -> ref.getPath().equals(sheetPath())), any(), any());
    }

    @Test
    void unchangedWeeklyStatusIsANoOpInsideALockedWeek() {
        Fixture fixture = fixture(
            member(Map.of("role", "finance", "projectIds", List.of())),
            activeLease()
        );
        Map<String, Object> closed = closedWeek();
        fixture.documents.put(weekPath(), new LinkedHashMap<>(closed));
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w1",
            lockedWeeklyCompletion("2026-07", 1, 1)
        );
        WeeklyExpenseWeeklyStatusEntity status = new WeeklyExpenseWeeklyStatusEntity(
            "tenant-a", "project-a", "2026-07", 1
        );
        status.restorePersistenceState(
            "status-1",
            "closed",
            "pm-1",
            Instant.parse(String.valueOf(closed.get("pmSubmittedAt"))),
            "finance-1",
            Instant.parse(String.valueOf(closed.get("adminClosedAt"))),
            NOW
        );

        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowMonthClosePermission(ACTOR, "project-a");
            fixture.persistence.saveWeeklyStatus(status);
            return null;
        })).doesNotThrowAnyException();
        assertThat(fixture.documents.get(weekPath())).isEqualTo(closed);
    }

    @Test
    void tenantAdminCanCompleteAWeeklySettlementWithoutProjectAssignment() {
        Fixture fixture = fixture(
            member(Map.of("role", "tenant_admin", "projectIds", List.of())),
            Map.of()
        );

        CashflowWeeklyUpdateCompletionResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).completeCashflowWeeklyUpdate(
            ACTOR,
            "project-a",
            new CompleteCashflowWeeklyUpdateRequest(
                "tenant-admin-weekly-complete", "2026-07", 3, "2026-07-16T09:00:00Z"
            )
        ));

        assertThat(response.status()).isEqualTo("LOCKED");
        assertThat(response.completedBy()).isEqualTo("pm@example.com");
    }

    @Test
    void legacyWeeklyCompletionIsUpgradedInsteadOfBeingTreatedAsALock() {
        Fixture fixture = fixture(activeMember(), Map.of());
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            new LinkedHashMap<>(Map.of(
                "projectId", "project-a",
                "yearMonth", "2026-07",
                "weekNo", 3,
                "completedAt", "2026-07-10T09:00:00Z",
                "completedByUid", "legacy-user"
            ))
        );

        CashflowWeeklyUpdateCompletionResponse upgraded = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).completeCashflowWeeklyUpdate(
            ACTOR,
            "project-a",
            new CompleteCashflowWeeklyUpdateRequest(
                "upgrade-legacy-week", "2026-07", 3, "2026-07-16T09:00:00Z"
            )
        ));

        assertThat(upgraded.alreadyCompleted()).isFalse();
        assertThat(upgraded.status()).isEqualTo("LOCKED");
        assertThat(upgraded.revision()).isEqualTo(1L);
        assertThat(fixture.documents).containsKey(
            "orgs/tenant-a/cashflow_weekly_update_completion_versions/project-a-2026-07-w3-r1"
        );
    }

    @Test
    void weeklyLockIdempotencyCreatesOneVersionAndOneAuditEvent() {
        Fixture fixture = fixture(activeMember(), Map.of());
        WeeklyExpenseCommandService service = commandService(fixture.persistence);
        CompleteCashflowWeeklyUpdateRequest request = new CompleteCashflowWeeklyUpdateRequest(
            "same-weekly-lock", "2026-07", 3, "2026-07-16T09:00:00Z"
        );

        CashflowWeeklyUpdateCompletionResponse first = fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(ACTOR, "project-a", request)
        );
        CashflowWeeklyUpdateCompletionResponse replay = fixture.persistence.runCommandTransaction(() ->
            service.completeCashflowWeeklyUpdate(ACTOR, "project-a", request)
        );

        assertThat(replay).isEqualTo(first);
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/cashflow_weekly_update_completion_versions/")))
            .hasSize(1);
        assertThat(fixture.documents.keySet().stream()
            .filter(path -> path.contains("/weekly_api_audit_events/")))
            .hasSize(1);
    }

    @Test
    void weeklyReopenRejectsRevisionDriftAndClosedMonth() {
        Fixture revisionFixture = fixture(activeMember(), Map.of());
        revisionFixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 2)
        );
        assertThatThrownBy(() -> revisionFixture.persistence.runCommandTransaction(() -> commandService(
            revisionFixture.persistence
        ).reopenCashflowWeeklyUpdate(
            ACTOR,
            "project-a",
            new ReopenCashflowWeeklyUpdateRequest(
                "reopen-stale", "2026-07", 3, 1, "긴급 정정"
            )
        )))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("revision");

        Fixture closedFixture = fixture(activeMember(), Map.of());
        closedFixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3",
            lockedWeeklyCompletion("2026-07", 3, 1)
        );
        closedFixture.documents.put(monthClosePath("project-a", "2026-07"), Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "status", "CLOSED",
            "revision", 1L,
            "reopenCount", 0L
        ));
        assertThatThrownBy(() -> closedFixture.persistence.runCommandTransaction(() -> commandService(
            closedFixture.persistence
        ).reopenCashflowWeeklyUpdate(
            ACTOR,
            "project-a",
            new ReopenCashflowWeeklyUpdateRequest(
                "reopen-closed-month", "2026-07", 3, 1, "긴급 정정"
            )
        )))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("closed");
    }

    @Test
    void monthCloseClosesWithPinnedCellMismatchWarningAfterDesignatedApproval() {
        CloseCashflowMonthRequest pinned = monthCloseRequest("month-close-pinned-values", 0, 3);
        List<CashflowSheetLabApplyRequest.Cell> changedCells = new ArrayList<>(pinned.cells());
        CashflowSheetLabApplyRequest.Cell first = changedCells.getFirst();
        changedCells.set(0, new CashflowSheetLabApplyRequest.Cell(
            first.mode(),
            first.weekNo(),
            first.cashflowLine(),
            first.cellState(),
            first.amount().add(BigDecimal.ONE),
            first.sourceCell(),
            first.sourceLabel()
        ));
        CloseCashflowMonthRequest changed = new CloseCashflowMonthRequest(
            pinned.idempotencyKey(),
            pinned.sourceRevision(),
            pinned.targetRevision(),
            pinned.yearMonth(),
            pinned.expectedRevision(),
            pinned.expectedDraftRevision(),
            pinned.humanReviewed(),
            pinned.depositScheduleRows(),
            changedCells,
            pinned.confirmations(),
            pinned.managementChecks(),
            pinned.managementConfirmations(),
            pinned.openingBalances(),
            pinned.deadlineSummary()
        );
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, changed));
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", pinnedMirror(pinned));

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, changed));

        assertThat(response.status()).isEqualTo("CLOSED");
        assertThat(monthCloseWarningCodes(fixture, pinned.yearMonth()))
            .contains("PINNED_CELLS_MISMATCH");
    }

    @Test
    void monthCloseClosesWithoutMirrorAndRetainsApprovedRequestEvidence() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-missing-mirror", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
        String approvalPath = "orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06";
        Map<String, Object> approval = new LinkedHashMap<>(fixture.documents.get(approvalPath));
        approval.put("reviewWarnings", List.of(Map.of(
            "code", "SOURCE_MIRROR_MISSING",
            "message", "요청 시점에 mirror가 없었습니다."
        )));
        approval.put("monthSnapshot", Map.of(
            "schemaVersion", 1,
            "projectId", "project-a",
            "yearMonth", "2026-06"
        ));
        fixture.documents.put(approvalPath, approval);

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request));

        assertThat(response.status()).isEqualTo("CLOSED");
        Map<String, Object> snapshot = monthCloseVersionSnapshot(fixture, request.yearMonth());
        assertThat(monthCloseWarningCodes(fixture, request.yearMonth()))
            .contains("SOURCE_MIRROR_MISSING", "PINNED_MIRROR_MISSING");
        assertThat((Map<String, Object>) snapshot.get("sourceEvidence"))
            .containsEntry("mirrorExists", false);
        assertThat((Map<String, Object>) snapshot.get("approvedMonthSnapshot"))
            .containsEntry("projectId", "project-a")
            .containsEntry("yearMonth", "2026-06");
    }

    @Test
    void monthCloseClosesWithPinnedRevisionScopeAndApplyWarnings() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-source-drift", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
        Map<String, Object> mirror = pinnedMirror(request);
        mirror.put("status", "STALE");
        mirror.put("projectId", "other-project");
        mirror.put("sourceRevision", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        mirror.put("appliedSourceRevision", "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
        mirror.put("targetRevisionAtFetch", "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");
        mirror.put("yearMonths", List.of("2026-05"));
        mirror.remove("capturedAt");
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", mirror);

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request));

        assertThat(response.status()).isEqualTo("CLOSED");
        assertThat(monthCloseWarningCodes(fixture, request.yearMonth())).contains(
            "PINNED_MIRROR_SCOPE_OR_REVISION_DRIFT",
            "PINNED_SOURCE_NOT_APPLIED",
            "PINNED_SOURCE_TIME_MISSING"
        );
    }

    @Test
    void monthCloseClosesWithSheetIssueControlAndDepositWarnings() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-sheet-warnings", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
        Map<String, Object> mirror = pinnedMirror(request);
        mirror.put("cells", List.of());
        Map<String, Object> facts = new LinkedHashMap<>((Map<String, Object>) mirror.get("sheetFacts"));
        facts.put("issues", List.of(Map.of("code", "INVALID_DATE", "sourceCell", "B2")));
        facts.put("depositScheduleRows", List.of());
        Map<String, Object> controls = new LinkedHashMap<>((Map<String, Object>) facts.get("controlTotals"));
        controls.remove("deposit");
        controls.put("projection", List.of());
        controls.put("actual", List.of(Map.of("sourceCell", "BO37")));
        facts.put("controlTotals", controls);
        mirror.put("sheetFacts", facts);
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", mirror);

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request));

        assertThat(response.status()).isEqualTo("CLOSED");
        assertThat(monthCloseWarningCodes(fixture, request.yearMonth())).contains(
            "PINNED_CELLS_MISMATCH",
            "PINNED_SHEET_VALUE_ISSUES",
            "PINNED_DEPOSIT_CONTROL_INCOMPLETE",
            "PINNED_PROJECTION_CONTROLS_INCOMPLETE",
            "PINNED_ACTUAL_CONTROLS_INCOMPLETE",
            "PINNED_DEPOSIT_SCHEDULE_MISMATCH"
        );
        assertThat((Map<String, Object>) monthCloseVersionSnapshot(fixture, request.yearMonth()).get("sheetFacts"))
            .containsEntry("issues", facts.get("issues"));
    }

    @Test
    void monthCloseRejectsChangedOpeningRowsEvenWhenTheNetTotalIsUnchanged() {
        Fixture fixture = fixture(activeMember(), activeLease());
        CashflowSheetAnnualApplyRequest annual = new CashflowSheetAnnualApplyRequest(
            "annual-opening-rows",
            SOURCE_REVISION,
            2025,
            0,
            annualCellsWithProjection("SALES_IN", new BigDecimal("2000000"))
        );
        fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWritePermission(ACTOR, "project-a");
            fixture.persistence.replaceCashflowSheetYearTotal(
                "tenant-a",
                "project-a",
                "cashflow-sheet-lab",
                annual
            );
            return null;
        });

        CloseCashflowMonthRequest base = monthCloseRequest("month-close-opening-row-drift", 0, 3);
        CashflowOpeningBalancesResponse staleOpening = openingBalanceForProjection(
            2026,
            2025,
            "TEAM_SUPPORT_IN",
            new BigDecimal("2000000")
        );
        CloseCashflowMonthRequest request = new CloseCashflowMonthRequest(
            base.idempotencyKey(),
            base.sourceRevision(),
            base.targetRevision(),
            base.yearMonth(),
            base.expectedRevision(),
            base.expectedDraftRevision(),
            base.humanReviewed(),
            base.depositScheduleRows(),
            base.cells(),
            base.confirmations(),
            base.managementChecks(),
            base.managementConfirmations(),
            staleOpening,
            base.deadlineSummary()
        );
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", pinnedMirror(request));

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request)))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("opening balance changed");

        assertThat(fixture.documents).doesNotContainKey(monthClosePath("project-a", request.yearMonth()));
    }

    @Test
    void monthCloseAllowsPinnedSheetControlMismatchAfterDesignatedApproval() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-control-mismatch", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
        Map<String, Object> mirror = pinnedMirror(request);
        Map<String, Object> facts = new LinkedHashMap<>((Map<String, Object>) mirror.get("sheetFacts"));
        Map<String, Object> controls = new LinkedHashMap<>((Map<String, Object>) facts.get("controlTotals"));
        controls.put("deposit", Map.of("sourceCell", "BO9", "value", 1_000_000L, "computed", 999_999L, "matches", false));
        facts.put("controlTotals", controls);
        mirror.put("sheetFacts", facts);
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", mirror);

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request));

        assertThat(response.status()).isEqualTo("CLOSED");
        assertThat(fixture.documents).containsKey(monthClosePath("project-a", "2026-06"));
    }

    @Test
    void monthClosePersistsApprovedWarningsWithoutManagementConfirmations() {
        CloseCashflowMonthRequest base = monthCloseRequest("month-close-approved-warnings", 0, 3);
        List<CloseCashflowMonthRequest.ManagementCheck> managementChecks = List.of(
            new CloseCashflowMonthRequest.ManagementCheck(
                "labor-transfer", "WARNING", "MYSC 인건비 이관", "승인자가 확인한 경고", List.of("미이관 1건")
            ),
            new CloseCashflowMonthRequest.ManagementCheck("profit-vat-after-deposit", "OK", "수익·부가세 이관", "확인"),
            new CloseCashflowMonthRequest.ManagementCheck("negative-projection-balance", "OK", "Projection 잔액", "확인"),
            new CloseCashflowMonthRequest.ManagementCheck("future-prepay-over-million", "OK", "선입금 요청", "확인")
        );
        CloseCashflowMonthRequest request = new CloseCashflowMonthRequest(
            base.idempotencyKey(),
            base.sourceRevision(),
            base.targetRevision(),
            base.yearMonth(),
            base.expectedRevision(),
            base.expectedDraftRevision(),
            base.humanReviewed(),
            base.depositScheduleRows(),
            base.cells(),
            base.confirmations(),
            managementChecks,
            List.of(),
            base.openingBalances(),
            base.deadlineSummary()
        );
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
        Map<String, Object> mirror = pinnedMirror(request);
        Map<String, Object> facts = new LinkedHashMap<>((Map<String, Object>) mirror.get("sheetFacts"));
        Map<String, Object> controls = new LinkedHashMap<>((Map<String, Object>) facts.get("controlTotals"));
        controls.put("deposit", Map.of("sourceCell", "BO9", "value", 1_000_000L, "computed", 999_999L, "matches", false));
        facts.put("controlTotals", controls);
        mirror.put("sheetFacts", facts);
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", mirror);

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request));

        assertThat(response.status()).isEqualTo("CLOSED");
        Map<String, Object> snapshot = (Map<String, Object>) fixture.documents
            .get(monthCloseVersionPath("project-a", "2026-06", 1))
            .get("snapshot");
        assertThat((List<?>) snapshot.get("managementConfirmations")).isEmpty();
        assertThat((List<Map<String, Object>>) snapshot.get("managementChecks"))
            .anySatisfy(check -> assertThat(check)
                .containsEntry("id", "labor-transfer")
                .containsEntry("status", "WARNING"));
        assertThat((Map<String, Object>) ((Map<String, Object>) snapshot.get("sheetFacts")).get("controlTotals"))
            .hasEntrySatisfying("deposit", value -> assertThat((Map<String, Object>) value)
                .containsEntry("matches", false));
    }

    @Test
    void monthCloseRequiresTheDesignatedApproverRequestInsideTheJVM() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-without-approval", 0, 3);
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.remove("orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06");
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", pinnedMirror(request));

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request)))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("designated approver");

        assertThat(fixture.documents).doesNotContainKey(monthClosePath("project-a", "2026-06"));
    }

    @Test
    void stageQaBusinessDateAllowsNextMonthCloseWithoutChangingRealTimestamps() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-qa-date", 0, 3, "2026-07");
        Fixture fixture = fixture(activeMember(), activeLease(), true, LocalDate.parse("2026-08-01"));
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", pinnedMirror(request));

        CashflowMonthCloseResponse open = commandService(fixture.persistence).readCashflowMonthClose(
            new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm"), "project-a", "2026-07"
        );
        assertThat(open.closeEligible()).isTrue();
        assertThat(open.evaluatedBusinessDate()).isEqualTo("2026-08-01");
        assertThat(open.closeDeadline()).isEqualTo("2026-08-10");

        CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request));

        assertThat(response.status()).isEqualTo("CLOSED");
        assertThat(response.late()).isFalse();
        assertThat(response.closedAt()).isEqualTo(NOW.toString());
        assertThat(response.snapshot())
            .containsEntry("evaluatedBusinessDate", "2026-08-01")
            .containsEntry("qaDateOverride", true);
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "ACTIVE")
            .doesNotContainKeys("releasedAt", "releaseReason");
    }

    @Test
    void stageQaBusinessDateKeepsTheTenthOnTimeAndMarksTheEleventhLate() {
        for (Map.Entry<LocalDate, Boolean> boundary : Map.of(
            LocalDate.parse("2026-08-10"), false,
            LocalDate.parse("2026-08-11"), true
        ).entrySet()) {
            CloseCashflowMonthRequest request = monthCloseRequest(
                "month-close-boundary-" + boundary.getKey(),
                0,
                3,
                "2026-07"
            );
            Fixture fixture = fixture(activeMember(), activeLease(), true, boundary.getKey());
            fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
            fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", pinnedMirror(request));

            CashflowMonthCloseResponse response = fixture.persistence.runCommandTransaction(() -> commandService(
                fixture.persistence
            ).closeCashflowMonth(ACTOR, "project-a", SESSION, request));

            assertThat(response.late()).isEqualTo(boundary.getValue());
        }
    }

    @Test
    void stageQaBusinessDateStillRejectsClosingBeforeTheTargetMonthEnds() {
        CloseCashflowMonthRequest request = monthCloseRequest("month-close-too-early", 0, 3, "2026-07");
        Fixture fixture = fixture(activeMember(), activeLease(), true, LocalDate.parse("2026-07-31"));
        fixture.documents.put(draftPath("project-a", "pm-1"), activeDraft("project-a", 3, request));
        fixture.documents.put("orgs/tenant-a/cashflow_sheet_mirrors/project-a", pinnedMirror(request));

        CashflowMonthCloseResponse open = commandService(fixture.persistence).readCashflowMonthClose(
            new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm"), "project-a", "2026-07"
        );
        assertThat(open.closeEligible()).isFalse();
        assertThat(open.evaluatedBusinessDate()).isEqualTo("2026-07-31");

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).closeCashflowMonth(ACTOR, "project-a", SESSION, request)))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("after the target month ends");
    }

    @Test
    void qaBusinessDateConfigurationIsStrictAndStageOnly() {
        Clock actualClock = Clock.fixed(NOW, ZoneOffset.UTC);
        CashflowMonthCloseBusinessDate overridden = new CashflowMonthCloseBusinessDate("stage", "2026-08-11");
        CashflowMonthCloseBusinessDate runtime = new CashflowMonthCloseBusinessDate("stage", "  ");
        CashflowMonthCloseBusinessDate actual = new CashflowMonthCloseBusinessDate("local", "  ");

        assertThat(overridden.currentDate(actualClock)).isEqualTo(LocalDate.parse("2026-08-11"));
        assertThat(overridden.qaOverrideActive()).isTrue();
        assertThat(runtime.currentDate(actualClock, LocalDate.parse("2026-08-05"))).isEqualTo(LocalDate.parse("2026-08-05"));
        assertThat(runtime.qaOverrideActive(LocalDate.parse("2026-08-05"))).isTrue();
        assertThat(actual.currentDate(actualClock)).isEqualTo(LocalDate.parse("2026-07-10"));
        assertThat(actual.currentDate(actualClock, LocalDate.parse("2026-08-05"))).isEqualTo(LocalDate.parse("2026-07-10"));
        assertThat(actual.qaOverrideActive()).isFalse();
        assertThatThrownBy(() -> new CashflowMonthCloseBusinessDate("live", "2026-08-11"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Stage");
        assertThatThrownBy(() -> new CashflowMonthCloseBusinessDate("stage", "2026-02-30"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("YYYY-MM-DD");
    }

    @Test
    void varianceFlagReplyResolveUsesStoredRolesRevisionFenceAndAppendOnlyHistory() {
        Fixture fixture = fixture(member(Map.of(
            "role", "tenant_admin",
            "projectIds", List.of(),
            "name", "Tenant Admin"
        )), activeLease());
        fixture.documents.put(varianceWeekPath(), varianceWeek());
        WeeklyExpenseCommandService service = commandService(fixture.persistence);

        CashflowVarianceRequest flagRequest = new CashflowVarianceRequest(
            "variance-flag",
            "week-a",
            0L,
            "FLAG",
            "입금 편차 확인"
        );
        CashflowVarianceResponse flagged = fixture.persistence.runCommandTransaction(() -> service.updateCashflowVariance(
            ACTOR, "project-a", SESSION, flagRequest
        ));
        CashflowVarianceResponse replay = fixture.persistence.runCommandTransaction(() -> service.updateCashflowVariance(
            ACTOR, "project-a", SESSION, flagRequest
        ));

        assertThat(replay).isEqualTo(flagged);
        assertThat(flagged.week().id()).isEqualTo("week-a");
        assertThat(flagged.week().projectId()).isEqualTo("project-a");
        assertThat(flagged.week().varianceRevision()).isEqualTo(1);
        assertThat(flagged.week().varianceFlag())
            .containsEntry("status", "OPEN")
            .containsEntry("reason", "입금 편차 확인")
            .containsEntry("flaggedBy", "Tenant Admin")
            .containsEntry("flaggedByUid", "pm-1");
        assertThat(flagged.week().varianceHistory()).singleElement().satisfies(event ->
            assertThat(event)
                .containsEntry("id", "vf-1")
                .containsEntry("action", "FLAG")
                .containsEntry("content", "입금 편차 확인")
        );

        fixture.documents.put("orgs/tenant-a/members/pm-1", member(Map.of(
            "role", "pm",
            "name", "Project Manager"
        )));
        CashflowVarianceResponse replied = fixture.persistence.runCommandTransaction(() -> service.updateCashflowVariance(
            ACTOR,
            "project-a",
            SESSION,
            new CashflowVarianceRequest("variance-reply", "week-a", 1L, "REPLY", "입금일 확인 완료")
        ));
        assertThat(replied.week().varianceRevision()).isEqualTo(2);
        assertThat(replied.week().varianceFlag())
            .containsEntry("status", "REPLIED")
            .containsEntry("pmReply", "입금일 확인 완료")
            .containsEntry("pmRepliedBy", "Project Manager");
        assertThat(replied.week().varianceHistory()).hasSize(2);

        fixture.documents.put("orgs/tenant-a/members/pm-1", member(Map.of(
            "role", "finance",
            "projectIds", List.of(),
            "name", "Finance Admin"
        )));
        CashflowVarianceResponse resolved = fixture.persistence.runCommandTransaction(() -> service.updateCashflowVariance(
            ACTOR,
            "project-a",
            SESSION,
            new CashflowVarianceRequest("variance-resolve", "week-a", 2L, "RESOLVE", "")
        ));

        assertThat(resolved.week().varianceRevision()).isEqualTo(3);
        assertThat(resolved.week().varianceFlag())
            .containsEntry("status", "RESOLVED")
            .containsEntry("resolvedBy", "Finance Admin");
        assertThat(resolved.week().varianceHistory()).hasSize(3);
        assertThat(resolved.week().varianceHistory().get(2))
            .containsEntry("id", "vf-3")
            .containsEntry("action", "RESOLVE")
            .containsEntry("content", "해결 처리");
        assertThat(fixture.documents.get(varianceWeekPath()))
            .containsEntry("varianceRevision", 3L)
            .containsEntry("updatedByUid", "pm-1");
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "ACTIVE")
            .doesNotContainKeys("releasedAt", "releaseReason");
        assertThat(fixture.documents.keySet())
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_audit_events/"))
            .anyMatch(path -> path.startsWith("orgs/tenant-a/weekly_api_idempotency/"));
    }

    @Test
    void varianceRejectsWrongActionRolesBeforeWriting() {
        for (Map.Entry<String, String> denied : Map.of(
            "pm", "FLAG",
            "admin", "REPLY",
            "finance", "REPLY",
            "tenant_admin", "REPLY"
        ).entrySet()) {
            Fixture fixture = fixture(member(Map.of("role", denied.getKey())), activeLease());
            fixture.documents.put(varianceWeekPath(), varianceWeek());

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
                fixture.persistence
            ).updateCashflowVariance(
                ACTOR,
                "project-a",
                SESSION,
                new CashflowVarianceRequest(
                    "variance-role-" + denied.getKey(),
                    "week-a",
                    0L,
                    denied.getValue(),
                    "검토"
                )
            )))
                .isInstanceOf(WeeklyExpenseForbiddenException.class);
            assertThat(fixture.documents.get(varianceWeekPath()))
                .doesNotContainKeys("varianceRevision", "varianceFlag", "varianceHistory");
        }
    }

    @Test
    void varianceRejectsClosedMonthsStaleRevisionsAndInvalidStateWithoutPartialWrites() {
        for (String status : List.of("CLOSED", "REOPEN_REQUESTED")) {
            Fixture fixture = fixture(member(Map.of("role", "admin")), activeLease());
            fixture.documents.put(varianceWeekPath(), varianceWeek());
            fixture.documents.put(monthClosePath("project-a", "2026-07"), new LinkedHashMap<>(Map.of(
                "contractVersion", "cashflow-month-close-v1",
                "tenantId", "tenant-a",
                "projectId", "project-a",
                "yearMonth", "2026-07",
                "status", status,
                "revision", 1L,
                "reopenCount", 0L
            )));

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
                fixture.persistence
            ).updateCashflowVariance(
                ACTOR,
                "project-a",
                SESSION,
                new CashflowVarianceRequest("variance-closed-" + status, "week-a", 0L, "FLAG", "검토")
            )))
                .isInstanceOf(WeeklyExpenseEditLeaseException.class)
                .satisfies(error -> assertThat(((WeeklyExpenseEditLeaseException) error).code())
                    .isEqualTo("cashflow_month_closed"));
            assertThat(fixture.documents.get(varianceWeekPath()))
                .doesNotContainKeys("varianceRevision", "varianceFlag", "varianceHistory");
        }

        Fixture stale = fixture(member(Map.of("role", "admin")), activeLease());
        Map<String, Object> staleWeek = varianceWeek();
        staleWeek.put("varianceRevision", 1L);
        staleWeek.put("varianceFlag", Map.of("status", "OPEN", "reason", "기존 검토"));
        staleWeek.put("varianceHistory", List.of(Map.of("id", "vf-1", "action", "FLAG")));
        stale.documents.put(varianceWeekPath(), staleWeek);

        assertThatThrownBy(() -> stale.persistence.runCommandTransaction(() -> commandService(
            stale.persistence
        ).updateCashflowVariance(
            ACTOR,
            "project-a",
            SESSION,
            new CashflowVarianceRequest("variance-stale", "week-a", 0L, "FLAG", "새 검토")
        )))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .satisfies(error -> assertThat(((WeeklyExpenseEditLeaseException) error).code())
                .isEqualTo("cashflow_metadata_version_conflict"));
        assertThat(stale.documents.get(varianceWeekPath())).isEqualTo(staleWeek);

        Fixture invalidState = fixture(member(Map.of("role", "finance")), activeLease());
        Map<String, Object> openWeek = varianceWeek();
        openWeek.put("varianceRevision", 1L);
        openWeek.put("varianceFlag", Map.of("status", "OPEN", "reason", "기존 검토"));
        openWeek.put("varianceHistory", List.of(Map.of("id", "vf-1", "action", "FLAG")));
        invalidState.documents.put(varianceWeekPath(), openWeek);
        assertThatThrownBy(() -> invalidState.persistence.runCommandTransaction(() -> commandService(
            invalidState.persistence
        ).updateCashflowVariance(
            ACTOR,
            "project-a",
            SESSION,
            new CashflowVarianceRequest("variance-resolve-too-early", "week-a", 1L, "RESOLVE", "")
        )))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .satisfies(error -> assertThat(((WeeklyExpenseEditLeaseException) error).code())
                .isEqualTo("cashflow_variance_state_conflict"));
        assertThat(invalidState.documents.get(varianceWeekPath())).isEqualTo(openWeek);
    }

    @Test
    void closedRequestedAndUnknownMonthStatesFailClosedForProjectionWrites() {
        for (String status : List.of("CLOSED", "REOPEN_REQUESTED", "DONE", "BROKEN", "open", " CLOSED ")) {
            Fixture fixture = fixture(activeMember(), activeLease());
            fixture.documents.put(monthClosePath("project-a", "2026-07"), Map.of(
                "contractVersion", "cashflow-month-close-v1",
                "tenantId", "tenant-a",
                "projectId", "project-a",
                "yearMonth", "2026-07",
                "status", status,
                "revision", 1L,
                "reopenCount", 0L
            ));

            assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
                fixture.persistence
            ).upsertProjection(
                ACTOR,
                "project-a",
                SESSION,
                new UpsertProjectionRequest("closed-" + status, List.of(
                    new UpsertProjectionRequest.ProjectionLinePatch("2026-07", 1, "SALES_IN", BigDecimal.TEN)
                ))
            )))
                .isInstanceOf(WeeklyExpenseConflictException.class);

            assertThat(fixture.documents).doesNotContainKey(weekPath());
            assertThat(fixture.documents.get(leasePath("project-a")))
                .containsEntry("state", "ACTIVE")
                .doesNotContainKeys("releasedAt", "releaseReason");
        }
    }

    @Test
    void unchangedClosedPastActualDoesNotBlockAChangedOpenMonth() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(monthClosePath("project-a", "2026-06"), closedMonth("2026-06", 1, 0));
        Map<String, Object> june = new LinkedHashMap<>(Map.of(
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-06",
            "weekNo", 1,
            "weeklyExpenseActualBySheet", Map.of("default", Map.of("SALES_IN", 500L)),
            "actual", Map.of("SALES_IN", 500L)
        ));
        String junePath = "orgs/tenant-a/cashflow_weeks/project-a-2026-06-w1";
        fixture.documents.put(junePath, june);

        fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            fixture.persistence.replaceActualLines(
                "tenant-a",
                "project-a",
                "default",
                List.of(
                    new SaveDraftResponse.ActualDelta("2026-06", 1, "SALES_IN", BigDecimal.valueOf(500)),
                    new SaveDraftResponse.ActualDelta("2026-07", 1, "SALES_IN", BigDecimal.valueOf(200))
                )
            );
            return null;
        });

        assertThat(fixture.documents.get(junePath)).isEqualTo(june);
        assertThat(fixture.documents.get(weekPath()))
            .containsEntry("yearMonth", "2026-07")
            .containsEntry("weekNo", 1);
        assertThat((Map<String, Object>) fixture.documents.get(weekPath()).get("actual"))
            .containsEntry("SALES_IN", 200L);
    }

    @Test
    void changedClosedPastActualRollsBackTheOpenMonthWrite() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(monthClosePath("project-a", "2026-06"), closedMonth("2026-06", 1, 0));
        Map<String, Object> june = new LinkedHashMap<>(Map.of(
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-06",
            "weekNo", 1,
            "weeklyExpenseActualBySheet", Map.of("default", Map.of("SALES_IN", 500L)),
            "actual", Map.of("SALES_IN", 500L)
        ));
        String junePath = "orgs/tenant-a/cashflow_weeks/project-a-2026-06-w1";
        fixture.documents.put(junePath, june);

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> {
            fixture.persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION);
            fixture.persistence.replaceActualLines(
                "tenant-a",
                "project-a",
                "default",
                List.of(
                    new SaveDraftResponse.ActualDelta("2026-06", 1, "SALES_IN", BigDecimal.valueOf(501)),
                    new SaveDraftResponse.ActualDelta("2026-07", 1, "SALES_IN", BigDecimal.valueOf(200))
                )
            );
            return null;
        }))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("closed");

        assertThat(fixture.documents.get(junePath)).isEqualTo(june);
        assertThat(fixture.documents).doesNotContainKey(weekPath());
        assertThat(fixture.documents.get(leasePath("project-a")))
            .containsEntry("state", "ACTIVE")
            .doesNotContainKeys("releasedAt", "releaseReason");
    }

    @Test
    void monthReopenRejectsMismatchedDataProjectBeforeChangingTheClose() {
        Fixture fixture = fixture(activeMember(), activeLease());
        Map<String, Object> closed = closedMonth("2026-06", 1, 0);
        fixture.documents.put(monthClosePath("project-a", "2026-06"), closed);

        assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() -> commandService(
            fixture.persistence
        ).requestCashflowMonthReopen(
            ACTOR,
            "project-a",
            "other-data-project",
            new RequestCashflowMonthReopenRequest("reopen-wrong-project", "2026-06", 1, "정정 필요")
        )))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .satisfies(error -> assertThat(((WeeklyExpenseEditLeaseException) error).code())
                .isEqualTo("cashflow_data_project_mismatch"));

        assertThat(fixture.documents.get(monthClosePath("project-a", "2026-06"))).isEqualTo(closed);
        assertThat(fixture.documents.keySet()).noneMatch(path -> path.contains("reopen-wrong-project"));
    }

    @Test
    void reopenReasonAndApprovalDriveStateAndWarningCountExactlyOnce() {
        Fixture fixture = fixture(activeMember(), activeLease());
        fixture.documents.put(monthClosePath("project-a", "2026-05"), Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-05",
            "status", "OPEN",
            "revision", 4L,
            "reopenCount", 2L
        ));
        fixture.documents.put(monthClosePath("project-a", "2026-06"), closedMonth("2026-06", 1, 0));
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weeks/project-a-2026-06-w3",
            new LinkedHashMap<>(Map.of(
                "id", "project-a-2026-06-w3",
                "tenantId", "tenant-a",
                "projectId", "project-a",
                "yearMonth", "2026-06",
                "weekNo", 3,
                "projection", Map.of("SALES_IN", 200L),
                "actual", Map.of()
            ))
        );
        fixture.documents.put(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-06-w3",
            lockedWeeklyCompletion("2026-06", 3, 1)
        );
        WeeklyExpenseCommandService service = commandService(fixture.persistence);

        CashflowMonthCloseResponse requested = fixture.persistence.runCommandTransaction(() -> service.requestCashflowMonthReopen(
            ACTOR,
            "project-a",
            "stage-data-project",
            new RequestCashflowMonthReopenRequest("reopen-request-1", "2026-06", 1, "6월 입금 반영 오류 수정")
        ));
        assertThat(requested.status()).isEqualTo("REOPEN_REQUESTED");
        assertThat(requested.reopenReason()).isEqualTo("6월 입금 반영 오류 수정");
        assertThat(requested.projectWarningCount()).isEqualTo(2);

        fixture.documents.put("orgs/tenant-a/members/pm-1", member(Map.of(
            "role", "finance",
            "projectIds", List.of()
        )));
        DecideCashflowMonthReopenRequest decision = new DecideCashflowMonthReopenRequest(
            "reopen-decision-1",
            "2026-06",
            requested.revision(),
            "APPROVE",
            "증빙 확인 완료"
        );
        CashflowMonthCloseResponse approved = fixture.persistence.runCommandTransaction(() -> service.decideCashflowMonthReopen(
            ACTOR,
            "project-a",
            "stage-data-project",
            decision
        ));
        CashflowMonthCloseResponse replay = fixture.persistence.runCommandTransaction(() -> service.decideCashflowMonthReopen(
            ACTOR,
            "project-a",
            "stage-data-project",
            decision
        ));

        assertThat(approved.status()).isEqualTo("OPEN");
        assertThat(approved.reopenCount()).isEqualTo(1);
        assertThat(approved.projectWarningCount()).isEqualTo(3);
        assertThat(approved.reopenDecision()).isEqualTo("APPROVE");
        assertThat(approved.reopenDecisionReason()).isEqualTo("증빙 확인 완료");
        assertThat(replay).isEqualTo(approved);
        assertThat(fixture.documents.get(monthClosePath("project-a", "2026-06")))
            .containsEntry("status", "OPEN")
            .containsEntry("reopenCount", 1L)
            .containsEntry("revision", 3L)
            .hasEntrySatisfying("reopenDecision", value -> assertThat((Map<String, Object>) value)
                .containsEntry("autoReopenedWeeklyCount", 1));
        assertThat(fixture.documents.get(
            "orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-06-w3"
        ))
            .containsEntry("status", "OPEN")
            .containsEntry("revision", 2L)
            .containsEntry("reopenSource", "MONTH_REOPEN_APPROVAL")
            .hasEntrySatisfying("reopenReason", value -> assertThat(value).asString().contains("증빙 확인 완료"));
        assertThat(fixture.persistence.runCommandTransaction(() -> service.readCashflowWeeklyUpdate(
            READ_ACTOR, "project-a", "2026-06", 3
        )).status()).isEqualTo("OPEN");
        assertThatCode(() -> fixture.persistence.runCommandTransaction(() -> service.upsertProjection(
            ACTOR,
            "project-a",
            SESSION,
            new UpsertProjectionRequest("projection-after-month-reopen", List.of(
                new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-06", 3, "SALES_IN", BigDecimal.valueOf(300)
                )
            ))
        ))).doesNotThrowAnyException();
    }

    @Test
    void monthCloseCountersRejectNegativeFractionalAndOutOfRangeValues() {
        for (String field : List.of("revision", "reopenCount")) {
            for (Number invalid : List.<Number>of(
                -1L,
                new BigDecimal("1.5"),
                new BigDecimal("9223372036854775808")
            )) {
                Fixture fixture = fixture(activeMember(), activeLease());
                Map<String, Object> close = closedMonth("2026-06", 1, 0);
                close.put(field, invalid);
                fixture.documents.put(monthClosePath("project-a", "2026-06"), close);

                assertThatThrownBy(() -> fixture.persistence.runCommandTransaction(() ->
                    fixture.persistence.findCashflowMonthClose("tenant-a", "project-a", "2026-06")
                ))
                    .isInstanceOf(WeeklyExpenseConflictException.class)
                    .hasMessageContaining("non-negative whole numbers");
            }
        }
    }

    @Test
    void projectWarningCountAndRevisionIncrementFailClosedOnOverflow() {
        Fixture warningFixture = fixture(activeMember(), activeLease());
        warningFixture.documents.put(
            monthClosePath("project-a", "2026-05"),
            closedMonth("2026-05", 1, Long.MAX_VALUE)
        );
        warningFixture.documents.put(
            monthClosePath("project-a", "2026-06"),
            closedMonth("2026-06", 1, 1)
        );

        assertThatThrownBy(() -> warningFixture.persistence.runCommandTransaction(() ->
            warningFixture.persistence.findCashflowMonthClose("tenant-a", "project-a", "2026-06")
        ))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("exceeds the supported range");

        Fixture revisionFixture = fixture(activeMember(), activeLease());
        revisionFixture.documents.put(
            monthClosePath("project-a", "2026-06"),
            closedMonth("2026-06", Long.MAX_VALUE, 0)
        );

        assertThatThrownBy(() -> revisionFixture.persistence.runCommandTransaction(() ->
            revisionFixture.persistence.requestCashflowMonthReopen(
                ACTOR,
                "project-a",
                new RequestCashflowMonthReopenRequest(
                    "overflow-revision",
                    "2026-06",
                    Long.MAX_VALUE,
                    "revision overflow must fail closed"
                )
            )
        ))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("exceeds the supported range");
        assertThat(revisionFixture.documents.get(monthClosePath("project-a", "2026-06")))
            .containsEntry("status", "CLOSED")
            .containsEntry("revision", Long.MAX_VALUE);
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
                org.assertj.core.api.Assertions.assertThat(lease.code()).isEqualTo("cashflow_write_permission_required");
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

    private static CloseCashflowMonthRequest monthCloseRequest(
        String idempotencyKey,
        long expectedRevision,
        long expectedDraftRevision
    ) {
        return monthCloseRequest(idempotencyKey, expectedRevision, expectedDraftRevision, "2026-06");
    }

    private static CloseCashflowMonthRequest monthCloseRequest(
        String idempotencyKey,
        long expectedRevision,
        long expectedDraftRevision,
        String yearMonth
    ) {
        CashflowSheetLabApplyRequest month = monthlyRequest(
            idempotencyKey,
            "sha256:298012959db83e193536ff7f60735889252ceaa4325de6944465e2dd197fcb44",
            yearMonth,
            ""
        );
        List<CloseCashflowMonthRequest.Confirmation> confirmations = month.cells().stream()
            .map(cell -> new CloseCashflowMonthRequest.Confirmation(
                cell.mode(),
                cell.weekNo(),
                cell.cashflowLine(),
                "CONFIRMED"
            ))
            .toList();
        List<CloseCashflowMonthRequest.DepositScheduleRow> depositScheduleRows = new ArrayList<>();
        for (int weekNo = 1; weekNo <= 5; weekNo += 1) {
            depositScheduleRows.add(new CloseCashflowMonthRequest.DepositScheduleRow(
                weekNo,
                weekNo == 1 ? "2026-06-03" : "",
                weekNo == 1 ? "2026-06-10" : "",
                weekNo == 1 ? BigDecimal.valueOf(1_000_000) : null,
                weekNo == 1 ? "2026-06-10" : "",
                weekNo == 1 ? BigDecimal.valueOf(1_000_000) : null,
                weekNo == 1 ? "SHEET" : "NOT_APPLICABLE",
                weekNo == 1 ? "CONFIRMED" : "NOT_APPLICABLE"
            ));
        }
        return new CloseCashflowMonthRequest(
            idempotencyKey,
            SOURCE_REVISION,
            month.targetRevision(),
            month.yearMonth(),
            expectedRevision,
            expectedDraftRevision,
            true,
            depositScheduleRows,
            month.cells(),
            confirmations,
            List.of(
                new CloseCashflowMonthRequest.ManagementCheck("labor-transfer", "OK", "MYSC 인건비 이관", "확인"),
                new CloseCashflowMonthRequest.ManagementCheck("profit-vat-after-deposit", "OK", "수익·부가세 이관", "확인"),
                new CloseCashflowMonthRequest.ManagementCheck("negative-projection-balance", "OK", "Projection 잔액", "확인"),
                new CloseCashflowMonthRequest.ManagementCheck("future-prepay-over-million", "OK", "선입금 요청", "확인")
            ),
            List.of(
                new CloseCashflowMonthRequest.ManagementConfirmation("labor-transfer", "CONFIRMED"),
                new CloseCashflowMonthRequest.ManagementConfirmation("profit-vat-after-deposit", "CONFIRMED"),
                new CloseCashflowMonthRequest.ManagementConfirmation("negative-projection-balance", "CONFIRMED"),
                new CloseCashflowMonthRequest.ManagementConfirmation("future-prepay-over-million", "CONFIRMED")
            ),
            new CashflowOpeningBalancesResponse(
                Integer.parseInt(month.yearMonth().substring(0, 4)),
                new CashflowOpeningBalancesResponse.Mode(BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of()),
                new CashflowOpeningBalancesResponse.Mode(BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of())
            ),
            new CloseCashflowMonthRequest.DeadlineSummary("", 0, 0, null)
        );
    }

    private static List<CashflowSheetAnnualApplyRequest.Cell> annualCells() {
        List<CashflowSheetAnnualApplyRequest.Cell> cells = new ArrayList<>();
        for (String mode : List.of("projection", "actual")) {
            for (String lineId : CashflowLineCatalog.ALL_LINES) {
                cells.add(new CashflowSheetAnnualApplyRequest.Cell(
                    mode,
                    lineId,
                    "EMPTY",
                    null,
                    null,
                    lineId
                ));
            }
        }
        return cells;
    }

    private static List<CashflowSheetAnnualApplyRequest.Cell> annualCellsWithProjection(
        String lineId,
        BigDecimal amount
    ) {
        return annualCells().stream()
            .map(cell -> "projection".equals(cell.mode()) && lineId.equals(cell.cashflowLine())
                ? new CashflowSheetAnnualApplyRequest.Cell(
                    cell.mode(), cell.cashflowLine(), "VALUE", amount, "A1", cell.sourceLabel()
                )
                : cell)
            .toList();
    }

    private static CashflowOpeningBalancesResponse openingBalanceForProjection(
        int selectedYear,
        int sourceYear,
        String lineId,
        BigDecimal amount
    ) {
        Map<String, BigDecimal> rows = Map.of(lineId, amount);
        Map<String, String> states = new LinkedHashMap<>();
        for (String canonicalLine : CashflowLineCatalog.ALL_LINES) {
            states.put(canonicalLine, canonicalLine.equals(lineId) ? "VALUE" : "EMPTY");
        }
        CashflowOpeningBalancesResponse.YearSource source = new CashflowOpeningBalancesResponse.YearSource(
            sourceYear,
            rows,
            states
        );
        return new CashflowOpeningBalancesResponse(
            selectedYear,
            new CashflowOpeningBalancesResponse.Mode(
                amount,
                rows,
                List.of(source),
                List.of(sourceYear),
                List.of()
            ),
            new CashflowOpeningBalancesResponse.Mode(BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of())
        );
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
            false,
            null,
            null,
            List.of(),
            completeCalculationChecks(yearMonth),
            cells
        );
    }

    private static List<CashflowOpeningBalanceCell> openingBalanceCells() {
        List<CashflowOpeningBalanceCell> cells = new ArrayList<>();
        for (int year : List.of(2024, 2025)) {
            for (String mode : List.of("projection", "actual")) {
                for (String lineId : CashflowLineCatalog.ALL_LINES) {
                    boolean opening = year == 2025 && mode.equals("projection") && lineId.equals("SALES_IN");
                    cells.add(new CashflowOpeningBalanceCell(
                        year,
                        mode,
                        lineId,
                        opening ? "VALUE" : "EMPTY",
                        opening ? BigDecimal.valueOf(2_000_000) : null
                    ));
                }
            }
        }
        return List.copyOf(cells);
    }

    private static List<Map<String, Object>> completeCalculationChecks(String yearMonth) {
        List<Map<String, Object>> checks = new ArrayList<>();
        for (String mode : List.of("projection", "actual")) {
            for (int weekNo = 1; weekNo <= 5; weekNo += 1) {
                checks.add(Map.of(
                    "mode", mode,
                    "yearMonth", yearMonth,
                    "weekNo", weekNo,
                    "reported", Map.of(
                        "openingBalance", 0L,
                        "depositTotal", 800L,
                        "withdrawalTotal", 800L,
                        "balance", 0L
                    )
                ));
            }
        }
        return List.copyOf(checks);
    }

    private static Fixture fixture(Map<String, Object> member, Map<String, Object> lease) {
        return fixture(member, lease, true);
    }

    private static Fixture fixture(Map<String, Object> member, Map<String, Object> lease, boolean projectExists) {
        return fixture(member, lease, projectExists, null);
    }

    @SuppressWarnings("unchecked")
    private static Fixture fixture(
        Map<String, Object> member,
        Map<String, Object> lease,
        boolean projectExists,
        LocalDate cashflowMonthCloseQaDate
    ) {
        Firestore db = mock(Firestore.class);
        Transaction transaction = mock(Transaction.class);
        Map<String, DocumentReference> refs = new HashMap<>();
        Map<String, CollectionReference> collections = new HashMap<>();
        Map<Query, QueryScope> queryScopes = new HashMap<>();
        Map<String, Map<String, Object>> docs = new HashMap<>();
        List<PendingWrite> pendingWrites = new ArrayList<>();
        List<Integer> getAllSizes = new ArrayList<>();
        docs.put("orgs/tenant-a/members/pm-1", member);
        docs.put(leasePath("project-a"), lease);
        for (String yearMonth : List.of("2026-06", "2026-07")) {
            docs.put("orgs/tenant-a/cashflow_month_close_requests/project-a-" + yearMonth, Map.of(
                "requestId", "project-a-" + yearMonth,
                "projectId", "project-a",
                "yearMonth", yearMonth,
                "status", "APPROVING",
                "approverUid", "pm-1",
                "reviewedByUid", "pm-1"
            ));
        }
        if (projectExists) {
            docs.put("orgs/tenant-a/projects/project-a", Map.of(
                "id", "project-a",
                "tenantId", "tenant-a"
            ));
        }

        when(db.document(anyString())).thenAnswer(invocation -> {
            DocumentReference document = ref(refs, invocation.getArgument(0));
            org.mockito.Mockito.doAnswer(ignored -> {
                Map<String, Object> data = docs.get(document.getPath());
                DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
                when(snapshot.exists()).thenReturn(data != null);
                when(snapshot.getData()).thenReturn(data);
                when(snapshot.getReference()).thenReturn(document);
                return ApiFutures.immediateFuture(snapshot);
            }).when(document).get();
            return document;
        });
        when(db.collection(anyString())).thenAnswer(invocation -> collection(
            collections,
            refs,
            queryScopes,
            docs,
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
        when(transaction.getAll(any(DocumentReference[].class))).thenAnswer(invocation -> {
            Object[] arguments = invocation.getArguments();
            DocumentReference[] documents = arguments.length == 1 && arguments[0] instanceof DocumentReference[] refsArgument
                ? refsArgument
                : java.util.Arrays.stream(arguments)
                .map(DocumentReference.class::cast)
                .toArray(DocumentReference[]::new);
            getAllSizes.add(documents.length);
            List<DocumentSnapshot> snapshots = java.util.Arrays.stream(documents).map(document -> {
                Map<String, Object> data = docs.get(document.getPath());
                String documentId = document.getId();
                DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
                when(snapshot.exists()).thenReturn(data != null);
                when(snapshot.getData()).thenReturn(data);
                when(snapshot.getReference()).thenReturn(document);
                when(snapshot.getId()).thenReturn(documentId);
                return snapshot;
            }).toList();
            return ApiFutures.immediateFuture(snapshots);
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
                new LinkedHashMap<>((Map<String, Object>) invocation.getArgument(1)),
                true
            ));
            return transaction;
        });
        when(transaction.set(any(DocumentReference.class), any())).thenAnswer(invocation -> {
            pendingWrites.add(new PendingWrite(
                invocation.getArgument(0),
                new LinkedHashMap<>((Map<String, Object>) invocation.getArgument(1)),
                false
            ));
            return transaction;
        });
        when(db.runTransaction(any())).thenAnswer(invocation -> {
            Transaction.Function<?> function = invocation.getArgument(0);
            pendingWrites.clear();
            try {
                Object result = function.updateCallback(transaction);
                for (PendingWrite write : pendingWrites) {
                    Map<String, Object> document = write.merge()
                        ? new LinkedHashMap<>(docs.getOrDefault(write.ref().getPath(), Map.of()))
                        : new LinkedHashMap<>();
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
            Clock.fixed(NOW, ZoneOffset.UTC),
            cashflowMonthCloseQaDate
        );
        return new Fixture(persistence, db, transaction, refs, collections, docs, pendingWrites, getAllSizes);
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
        Map<String, Map<String, Object>> docs,
        String path
    ) {
        return collections.computeIfAbsent(path, key -> {
            CollectionReference collection = mock(CollectionReference.class);
            when(collection.document(anyString())).thenAnswer(invocation -> ref(refs, key + "/" + invocation.getArgument(0)));
            when(collection.document()).thenAnswer(invocation -> ref(refs, key + "/generated-audit-id"));
            when(collection.whereEqualTo(anyString(), any())).thenAnswer(invocation -> {
                Query query = mock(Query.class);
                QueryScope scope = new QueryScope(key, invocation.getArgument(0), invocation.getArgument(1));
                queryScopes.put(query, scope);
                org.mockito.Mockito.doAnswer(ignored -> {
                    List<QueryDocumentSnapshot> snapshots = docs.entrySet().stream()
                        .filter(entry -> entry.getKey().startsWith(scope.collectionPath() + "/"))
                        .filter(entry -> java.util.Objects.equals(entry.getValue().get(scope.field()), scope.value()))
                        .map(entry -> queryDocumentSnapshot(refs, entry.getKey(), entry.getValue()))
                        .toList();
                    QuerySnapshot querySnapshot = mock(QuerySnapshot.class);
                    when(querySnapshot.getDocuments()).thenReturn(snapshots);
                    return ApiFutures.immediateFuture(querySnapshot);
                }).when(query).get();
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

    private static String draftPath(String projectId, String actorId) {
        String json = "[\"cashflow\",\"" + projectId + "\",\"" + actorId + "\"]";
        String id = "v1_" + Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes());
        return "orgs/tenant-a/privateEditDrafts/" + id;
    }

    private static Map<String, Object> activeDraft(
        String projectId,
        long revision,
        CloseCashflowMonthRequest request
    ) {
        Map<String, Object> closeInput = new LinkedHashMap<>();
        closeInput.put("yearMonth", request.yearMonth());
        closeInput.put("sourceRevision", request.sourceRevision());
        closeInput.put("targetRevision", request.targetRevision());
        closeInput.put("depositScheduleRows", request.depositScheduleRows());
        closeInput.put("cells", request.cells());
        closeInput.put("confirmations", request.confirmations());
        closeInput.put("managementChecks", request.managementChecks());
        closeInput.put("managementConfirmations", request.managementConfirmations());
        closeInput.put("deadlineSummary", request.deadlineSummary());
        Map<String, Object> storedCloseInput = (Map<String, Object>) stripNullValues(
            new ObjectMapper().convertValue(closeInput, Map.class)
        );
        Map<String, Object> draft = new LinkedHashMap<>(Map.of(
            "tenantId", "tenant-a",
            "ownerUid", "pm-1",
            "resourceType", "cashflow",
            "resourceId", projectId,
            "draftRevision", revision,
            "status", "ACTIVE",
            "createdAt", NOW.minusSeconds(300).toString(),
            "updatedAt", NOW.minusSeconds(30).toString()
        ));
        draft.put("payload", Map.of("monthClose", storedCloseInput));
        return draft;
    }

    private static Object stripNullValues(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getValue() != null) {
                    result.put(String.valueOf(entry.getKey()), stripNullValues(entry.getValue()));
                }
            }
            return result;
        }
        if (value instanceof List<?> list) {
            return list.stream().map(FirestoreCashflowLeaseGuardTest::stripNullValues).toList();
        }
        return value;
    }

    private static Map<String, Object> pinnedMirror(CloseCashflowMonthRequest request) {
        List<Map<String, Object>> sourceCells = request.cells().stream().map(cell -> {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("mode", cell.mode());
            value.put("yearMonth", request.yearMonth());
            value.put("weekNo", cell.weekNo());
            value.put("lineId", cell.cashflowLine());
            value.put("state", cell.cellState());
            value.put("sourceCell", cell.sourceCell());
            value.put("sourceLabel", cell.sourceLabel());
            if (cell.amount() != null) value.put("amount", cell.amount());
            return value;
        }).toList();
        List<Map<String, Object>> sourceDeposits = request.depositScheduleRows().stream().map(row -> {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("yearMonth", request.yearMonth());
            value.put("weekNo", row.weekNo());
            value.put("taxInvoiceIssuedDate", row.taxInvoiceIssuedDate());
            value.put("expectedDepositDate", row.expectedDepositDate());
            value.put("expectedDepositAmount", row.expectedDepositAmount());
            return value;
        }).toList();
        List<Map<String, Object>> projectionControls = new ArrayList<>();
        List<Map<String, Object>> actualControls = new ArrayList<>();
        for (int index = 0; index < 19; index += 1) {
            projectionControls.add(Map.of(
                "sourceCell", "BO" + (14 + index), "value", 0L, "computed", 0L, "matches", true
            ));
            actualControls.add(Map.of(
                "sourceCell", "BO" + (37 + index), "value", 0L, "computed", 0L, "matches", true
            ));
        }
        long depositTotal = request.depositScheduleRows().stream()
            .map(CloseCashflowMonthRequest.DepositScheduleRow::expectedDepositAmount)
            .filter(Objects::nonNull)
            .mapToLong(BigDecimal::longValueExact)
            .sum();
        Map<String, Object> controls = new LinkedHashMap<>();
        controls.put("deposit", Map.of(
            "sourceCell", "BO9", "value", depositTotal, "computed", depositTotal, "matches", true
        ));
        controls.put("unpaid", Map.of("sourceCell", "BP9", "value", 0L));
        controls.put("projection", projectionControls);
        controls.put("actual", actualControls);
        Map<String, Object> facts = new LinkedHashMap<>();
        facts.put("metadata", Map.of());
        facts.put("depositScheduleRows", sourceDeposits);
        facts.put("controlTotals", controls);
        facts.put("issues", List.of());
        Map<String, Object> mirror = new LinkedHashMap<>();
        mirror.put("projectId", "project-a");
        mirror.put("status", "FRESH");
        mirror.put("sourceRevision", request.sourceRevision());
        mirror.put("appliedSourceRevision", request.sourceRevision());
        mirror.put("targetRevisionAtFetch", request.targetRevision());
        mirror.put("yearMonths", List.of(request.yearMonth()));
        mirror.put("capturedAt", NOW.minusSeconds(120).toString());
        mirror.put("cells", sourceCells);
        mirror.put("sheetFacts", facts);
        return mirror;
    }

    private static String monthClosePath(String projectId, String yearMonth) {
        return "orgs/tenant-a/monthly_closes/" + projectId + "-" + yearMonth;
    }

    private static String monthCloseVersionPath(String projectId, String yearMonth, long revision) {
        return "orgs/tenant-a/monthly_close_versions/" + projectId + "-" + yearMonth + "-r" + revision;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> monthCloseVersionSnapshot(Fixture fixture, String yearMonth) {
        return (Map<String, Object>) fixture.documents
            .get(monthCloseVersionPath("project-a", yearMonth, 1))
            .get("snapshot");
    }

    @SuppressWarnings("unchecked")
    private static List<String> monthCloseWarningCodes(Fixture fixture, String yearMonth) {
        return ((List<Map<String, Object>>) monthCloseVersionSnapshot(fixture, yearMonth).get("reviewWarnings"))
            .stream()
            .map(warning -> String.valueOf(warning.get("code")))
            .toList();
    }

    private static Map<String, Object> closedMonth(String yearMonth, long revision, long reopenCount) {
        return new LinkedHashMap<>(Map.of(
            "contractVersion", "cashflow-month-close-v1",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", yearMonth,
            "status", "CLOSED",
            "revision", revision,
            "reopenCount", reopenCount,
            "snapshotHash", SOURCE_REVISION,
            "snapshot", Map.of("sourceFingerprint", SOURCE_REVISION)
        ));
    }

    private static String weekPath() {
        return "orgs/tenant-a/cashflow_weeks/project-a-2026-07-w1";
    }

    private static String varianceWeekPath() {
        return "orgs/tenant-a/cashflow_weeks/week-a";
    }

    private static Map<String, Object> varianceWeek() {
        return new LinkedHashMap<>(Map.of(
            "id", "week-a",
            "tenantId", "tenant-a",
            "projectId", "project-a",
            "yearMonth", "2026-07",
            "weekNo", 1
        ));
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

    private static Map<String, Object> lockedWeeklyCompletion(String yearMonth, int weekNo, long revision) {
        return new LinkedHashMap<>(Map.ofEntries(
            Map.entry("id", "project-a-" + yearMonth + "-w" + weekNo),
            Map.entry("tenantId", "tenant-a"),
            Map.entry("projectId", "project-a"),
            Map.entry("yearMonth", yearMonth),
            Map.entry("weekNo", weekNo),
            Map.entry("status", "LOCKED"),
            Map.entry("revision", revision),
            Map.entry("reopenCount", 0L),
            Map.entry("snapshotHash", "sha256:" + "a".repeat(64)),
            Map.entry("completedAt", NOW.toString()),
            Map.entry("completedByUid", "pm-1")
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
        Firestore db,
        Transaction transaction,
        Map<String, DocumentReference> refs,
        Map<String, CollectionReference> collections,
        Map<String, Map<String, Object>> documents,
        List<PendingWrite> pendingWrites,
        List<Integer> getAllSizes
    ) {
    }

    private record PendingWrite(DocumentReference ref, Map<String, Object> data, boolean merge) {
    }

    private record QueryScope(String collectionPath, String field, Object value) {
    }
}
