package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowSheetOperationStatusResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CashflowSheetOperationStatusServiceTest {
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a", "viewer-a", "viewer@example.com", "viewer"
    );

    @Test
    void normalizesMonthBatchAndAnnualResultsWithoutReturningStoredPayloads() {
        assertThat(status("MONTH_APPLY", """
            {"projectId":"project-a","yearMonth":"2026-07","sourceRevision":"source-1",
             "targetRevision":"target-1","resultingTargetRevision":"target-2","auditId":"audit-month",
             "projection":[{"secret":"must-not-leak"}]}
            """))
            .returns("APPLIED", CashflowSheetOperationStatusResponse::status)
            .returns("source-1", CashflowSheetOperationStatusResponse::sourceRevision)
            .returns("target-1", CashflowSheetOperationStatusResponse::expectedTargetRevision)
            .returns("target-2", CashflowSheetOperationStatusResponse::resultingTargetRevision)
            .returns(java.util.List.of("2026-07"), CashflowSheetOperationStatusResponse::appliedMonths)
            .returns(java.util.List.of(), CashflowSheetOperationStatusResponse::appliedYears)
            .returns(Instant.parse("2026-07-30T01:02:03Z"), CashflowSheetOperationStatusResponse::completedAt);

        assertThat(status("BATCH_APPLY", """
            {"projectId":"project-a","sourceRevision":"source-2","expectedTargetRevision":"target-2",
             "resultingTargetRevision":"target-3","months":[{"yearMonth":"2026-07"},{"yearMonth":"2026-08"}],
             "auditId":"audit-batch","futureField":{"ignored":true}}
            """))
            .returns(java.util.List.of("2026-07", "2026-08"), CashflowSheetOperationStatusResponse::appliedMonths)
            .returns("audit-batch", CashflowSheetOperationStatusResponse::auditId);

        CashflowSheetOperationStatusResponse annual = status("ANNUAL_APPLY", """
            {"projectId":"project-a","year":2026,"sourceRevision":"source-3","revision":9,
             "auditId":"audit-annual","futureMutationResponseField":"ignored"}
            """);
        assertThat(annual.appliedMonths()).isEmpty();
        assertThat(annual.appliedYears()).containsExactly(2026);
        assertThat(annual.annualRevisions()).containsExactly(
            new CashflowSheetOperationStatusResponse.AnnualRevisionEvidence(2026, 9)
        );
    }

    @Test
    void returnsNotFoundForMissingOrMismatchedIdentityAndType() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "missing-key"
        )).thenReturn(Optional.empty());
        WeeklyExpenseCommandService service = service(persistence);

        assertThat(service.readCashflowSheetOperationStatus(ACTOR, "project-a", "MONTH_APPLY", "missing-key").status())
            .isEqualTo("NOT_FOUND");

        when(persistence.findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "batch-key"
        )).thenReturn(Optional.of(entity("tenant-a", "project-a", "batch-key", """
            {"projectId":"project-a","months":[{"yearMonth":"2026-07"}],"sourceRevision":"source",
             "targetRevision":"target","resultingTargetRevision":"result","auditId":"audit"}
            """)));
        assertThat(service.readCashflowSheetOperationStatus(ACTOR, "project-a", "MONTH_APPLY", "batch-key").status())
            .isEqualTo("NOT_FOUND");

        when(persistence.findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "wrong-scope"
        )).thenReturn(Optional.of(entity("tenant-b", "project-b", "wrong-scope", "{}")));
        assertThat(service.readCashflowSheetOperationStatus(ACTOR, "project-a", "MONTH_APPLY", "wrong-scope").status())
            .isEqualTo("NOT_FOUND");
    }

    @Test
    void rejectsMalformedLookupAndDoesNotHidePersistenceOrStoredJsonFailures() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseCommandService service = service(persistence);

        assertThatThrownBy(() -> service.readCashflowSheetOperationStatus(ACTOR, "project-a", "month", "key"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.readCashflowSheetOperationStatus(ACTOR, "project-a", "MONTH_APPLY", "\n"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.readCashflowSheetOperationStatus(
            ACTOR, "project-a", "MONTH_APPLY", "x".repeat(161)
        )).isInstanceOf(IllegalArgumentException.class);

        when(persistence.findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "read-failure"
        )).thenThrow(new IllegalStateException("Firestore unavailable"));
        assertThatThrownBy(() -> service.readCashflowSheetOperationStatus(
            ACTOR, "project-a", "MONTH_APPLY", "read-failure"
        )).isInstanceOf(IllegalStateException.class).hasMessage("Firestore unavailable");

        when(persistence.findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "bad-json"
        )).thenReturn(Optional.of(entity("tenant-a", "project-a", "bad-json", "{")));
        assertThatThrownBy(() -> service.readCashflowSheetOperationStatus(ACTOR, "project-a", "MONTH_APPLY", "bad-json"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Stored idempotent response is invalid JSON");
    }

    @Test
    void usesReadAuthorizationAndExactAuthoritativeLookupIdentity() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "key with / and +"
        )).thenReturn(Optional.empty());

        CashflowSheetOperationStatusResponse response = service(persistence).readCashflowSheetOperationStatus(
            ACTOR, "project-a", "MONTH_APPLY", "key with / and +"
        );

        assertThat(response.idempotencyKeyHash())
            .matches("sha256:[a-f0-9]{64}")
            .doesNotContain("key with");
        verify(persistence).findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "key with / and +"
        );
    }

    private static CashflowSheetOperationStatusResponse status(String operationType, String responseJson) {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "operation-key"
        )).thenReturn(Optional.of(entity("tenant-a", "project-a", "operation-key", responseJson)));
        return service(persistence).readCashflowSheetOperationStatus(ACTOR, "project-a", operationType, "operation-key");
    }

    private static WeeklyExpenseIdempotencyEntity entity(
        String tenantId,
        String projectId,
        String key,
        String responseJson
    ) {
        WeeklyExpenseIdempotencyEntity entity = new WeeklyExpenseIdempotencyEntity(
            tenantId,
            projectId,
            key,
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            "request-hash",
            responseJson
        );
        entity.restorePersistenceState("idempotency-id", Instant.parse("2026-07-30T01:02:03Z"));
        return entity;
    }

    private static WeeklyExpenseCommandService service(WeeklyExpensePersistence persistence) {
        return new WeeklyExpenseCommandService(
            persistence,
            new WeeklyExpenseAuthorizationService((actor, projectId) -> true, new WeeklyProjectExistenceRepository() {
                @Override
                public boolean exists(String tenantId, String projectId) {
                    return true;
                }

                @Override
                public boolean existsCanonicalProject(String tenantId, String projectId) {
                    return true;
                }
            }, "strict"),
            new ObjectMapper(),
            true,
            "stage"
        );
    }
}
