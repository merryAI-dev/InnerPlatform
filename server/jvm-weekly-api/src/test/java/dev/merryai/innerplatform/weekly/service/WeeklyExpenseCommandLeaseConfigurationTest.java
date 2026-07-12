package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionRequest;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseAtomicWriteLimitException;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class WeeklyExpenseCommandLeaseConfigurationTest {
    @Test
    void disabledLeaseFlagFailsClosedBeforePersistence() {
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

        assertThatThrownBy(() -> service.upsertProjection(
            new TrustedActorContext("tenant-a", "finance-1", "finance@example.com", "finance"),
            "project-a",
            new CashflowEditSession("stage-data-project", "session-a", "lease-a", 1),
            request
        ))
            .isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .extracting(error -> ((WeeklyExpenseEditLeaseException) error).statusCode())
            .isEqualTo(503);
        verifyNoInteractions(persistence);
    }

    @Test
    void existingActualWeekRewritesAreCountedBeforeFirstWrite() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWriteLease(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.any()
        )).thenReturn("pm");
        when(persistence.countCashflowActualReplacementWrites(
            "tenant-a",
            "project-a",
            "cashflow-sheet-lab",
            List.of("project-a-2026-07-w1")
        )).thenReturn(499);
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
            "stage"
        );
        CashflowSheetLabApplyRequest request = new CashflowSheetLabApplyRequest(
            "apply-over-existing-budget",
            List.of(
                new CashflowSheetLabApplyRequest.LinePatch(
                    "projection",
                    "2026-07",
                    1,
                    "SALES_IN",
                    BigDecimal.valueOf(2000),
                    "D12",
                    "매출액"
                ),
                new CashflowSheetLabApplyRequest.LinePatch(
                    "actual",
                    "2026-07",
                    1,
                    "DIRECT_COST_OUT",
                    BigDecimal.valueOf(1000),
                    "D39",
                    "직접사업비"
                )
            )
        );

        assertThatThrownBy(() -> service.applyCashflowSheetLab(
            new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm"),
            "project-a",
            new CashflowEditSession("stage-data-project", "session-a", "lease-a", 1),
            request
        ))
            .isInstanceOf(WeeklyExpenseAtomicWriteLimitException.class)
            .satisfies(error -> {
                WeeklyExpenseAtomicWriteLimitException limit = (WeeklyExpenseAtomicWriteLimitException) error;
                org.assertj.core.api.Assertions.assertThat(limit.statusCode()).isEqualTo(422);
                org.assertj.core.api.Assertions.assertThat(limit.code()).isEqualTo("atomic_write_limit_exceeded");
                org.assertj.core.api.Assertions.assertThat(limit.expectedWriteCount()).isEqualTo(502);
            });

        verify(persistence, never()).replaceActualLines(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyList()
        );
        verify(persistence, never()).saveProjection(org.mockito.ArgumentMatchers.any());
        verify(persistence, never()).saveAuditEvent(org.mockito.ArgumentMatchers.any());
        verify(persistence, never()).saveIdempotency(org.mockito.ArgumentMatchers.any());
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
            "stage"
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
