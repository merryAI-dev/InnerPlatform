package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.service.command.CashflowMonthReopenCommands;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionRequest;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseAtomicWriteLimitException;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class WeeklyExpenseCommandLeaseConfigurationTest {
    @Test
    void emptyProjectionIsRejectedEvenForALegacyFinalizationSession() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence,
            new WeeklyExpenseAuthorizationService((actor, projectId) -> true, canonicalProjectsExist(), "strict"),
            new ObjectMapper(),
            true,
            "live"
        );
        CashflowEditSession finalSession = new CashflowEditSession(
            "stage-data-project", "session-a", "lease-a", 1, true
        );

        assertThatThrownBy(() -> service.upsertProjection(
            new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm"),
            "project-a",
            finalSession,
            new UpsertProjectionRequest("projection-final-no-change", List.of())
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("At least one projection line");
        verifyNoInteractions(persistence);
    }

    @Test
    void emptyProjectionWithoutFinalizationIsRejectedBeforeLeaseOrWrites() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence,
            new WeeklyExpenseAuthorizationService((actor, projectId) -> true, canonicalProjectsExist(), "strict"),
            new ObjectMapper(),
            true,
            "live"
        );

        assertThatThrownBy(() -> service.upsertProjection(
            new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm"),
            "project-a",
            new CashflowEditSession("stage-data-project", "session-a", "lease-a", 1),
            new UpsertProjectionRequest("projection-empty-non-final", List.of())
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("At least one projection line");
        verifyNoInteractions(persistence);
    }

    @Test
    void projectionWriteDoesNotDependOnTheLegacyLeaseFlag() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(any(), any())).thenReturn("finance");
        when(persistence.saveProjection(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(persistence.saveAuditEvent(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(persistence.saveIdempotency(any())).thenAnswer(invocation -> invocation.getArgument(0));
        WeeklyExpenseAuthorizationService authorization = new WeeklyExpenseAuthorizationService(
            (actor, projectId) -> true,
            canonicalProjectsExist(),
            "strict"
        );
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence,
            authorization,
            new ObjectMapper(),
            false,
            "local"
        );
        UpsertProjectionRequest request = new UpsertProjectionRequest(
            "projection-disabled",
            List.of(new UpsertProjectionRequest.ProjectionLinePatch(
                "2026-07",
                1,
                "SALES_IN",
                BigDecimal.valueOf(1000)
            ))
        );

        var response = service.upsertProjection(
            new TrustedActorContext("tenant-a", "finance-1", "finance@example.com", "finance"),
            "project-a",
            new CashflowEditSession("stage-data-project", "session-a", "lease-a", 1),
            request
        );

        assertThat(response.savedLineCount()).isEqualTo(1);
        verify(persistence, never()).requireCashflowWriteLease(any(), any(), any());
    }

    @Test
    void liveMonthReopenUsesTheCanonicalDataProjectGuard() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowMonthClosePermission(any(), any())).thenReturn("pm");
        doThrow(new WeeklyExpenseEditLeaseException(
            503,
            "cashflow_data_project_mismatch",
            "BFF and JVM cashflow data projects do not match."
        )).when(persistence).requireCashflowDataProject("wrong-live-project");
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence,
            new WeeklyExpenseAuthorizationService((actor, projectId) -> true, canonicalProjectsExist(), "strict"),
            new ObjectMapper(),
            true,
            "live"
        );

        assertThatThrownBy(() -> service.requestCashflowMonthReopen(
            new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm"),
            "project-a",
            "wrong-live-project",
            new CashflowMonthReopenCommands.RequestReopen("reopen-live", "2026-06", 1, "정정 필요")
        ))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .satisfies(error -> assertThat(((WeeklyExpenseEditLeaseException) error).code())
                .isEqualTo("cashflow_data_project_mismatch"));
        verify(persistence).requireCashflowDataProject("wrong-live-project");
    }

    @Test
    void projectionLimitReportsExpectedWriteCountBeforeLeaseLookupOrWrites() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = new WeeklyExpenseAuthorizationService(
            (actor, projectId) -> true,
            canonicalProjectsExist(),
            "strict"
        );
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence,
            authorization,
            new ObjectMapper(),
            true,
            "live"
        );
        UpsertProjectionRequest request = new UpsertProjectionRequest(
            "projection-over-limit",
            IntStream.range(0, 499)
                .mapToObj(index -> new UpsertProjectionRequest.ProjectionLinePatch(
                    "2026-07",
                    1,
                    "SALES_IN",
                    BigDecimal.valueOf(index + 1L)
                ))
                .toList()
        );

        assertThatThrownBy(() -> service.upsertProjection(
            new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm"),
            "project-a",
            new CashflowEditSession("stage-data-project", "session-a", "lease-a", 1),
            request
        ))
            .isInstanceOf(WeeklyExpenseAtomicWriteLimitException.class)
            .satisfies(error -> org.assertj.core.api.Assertions.assertThat(
                ((WeeklyExpenseAtomicWriteLimitException) error).expectedWriteCount()
            ).isEqualTo(501));

        verifyNoInteractions(persistence);
    }

    private static WeeklyProjectExistenceRepository canonicalProjectsExist() {
        return new WeeklyProjectExistenceRepository() {
            @Override
            public boolean exists(String tenantId, String projectId) {
                return true;
            }

            @Override
            public boolean existsCanonicalProject(String tenantId, String projectId) {
                return true;
            }
        };
    }
}
