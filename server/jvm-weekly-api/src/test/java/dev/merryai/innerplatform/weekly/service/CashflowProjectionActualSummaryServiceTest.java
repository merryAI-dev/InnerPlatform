package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowProjectionActualSummaryBatchRequest;
import dev.merryai.innerplatform.weekly.api.CashflowProjectionActualSummaryBatchResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseForbiddenException;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseProjectionEntity;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.math.BigDecimal;
import java.util.stream.IntStream;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CashflowProjectionActualSummaryServiceTest {
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a", "viewer-a", "viewer@example.com", "viewer", "Viewer A"
    );

    @Test
    void authorizesAllProjectsBeforeDeterministicBoundedCanonicalReads() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = service(persistence, authorization);
        WeeklyExpenseProjectionEntity projection = new WeeklyExpenseProjectionEntity(
            "tenant-a", "project-a", "2023-01", 1, "SALES_IN"
        );
        projection.setAmount(BigDecimal.TEN);
        when(persistence.findCashflowLedgerSource(eq("tenant-a"), eq("project-a"), eq("2023-01"), anyString()))
            .thenReturn(new WeeklyExpensePersistence.CashflowLedgerSource(List.of(projection), List.of(), List.of(2023)));
        when(persistence.findCashflowLedgerSource(eq("tenant-a"), eq("project-b"), eq("2023-01"), anyString()))
            .thenReturn(new WeeklyExpensePersistence.CashflowLedgerSource(List.of(), List.of(), List.of()));

        CashflowProjectionActualSummaryBatchResponse response = service.readCashflowProjectionActualSummaries(
            ACTOR, new CashflowProjectionActualSummaryBatchRequest(List.of("project-b", "project-a"))
        );

        assertThat(response.version()).isEqualTo("1");
        assertThat(response.items()).extracting(CashflowProjectionActualSummaryBatchResponse.Item::projectId)
            .containsExactly("project-a", "project-b");
        assertThat(response.items().getFirst().settlementDifferenceAmount()).isEqualByComparingTo("10");
        assertThat(response.items().getFirst().settlementMatches()).isFalse();
        assertThat(response.items().getLast().settlementDifferenceAmount()).isEqualByComparingTo("0");
        assertThat(response.items().getLast().settlementMatches()).isTrue();
        assertThat(response.errors()).isEmpty();
        InOrder order = inOrder(authorization, persistence);
        order.verify(authorization).requireProjectAllowed(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, ACTOR, "project-a");
        order.verify(authorization).requireProjectAllowed(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, ACTOR, "project-b");
        order.verify(persistence).findCashflowLedgerSource("tenant-a", "project-a", "2023-01", response.items().getFirst().comparisonAsOfWeek().yearMonth());
    }

    @Test
    void isolatesOneRepositoryFailureAcrossTenAuthorizedProjectsWithoutLeakingItsSecret() throws Exception {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = service(persistence, authorization);
        List<String> projectIds = IntStream.rangeClosed(1, 10)
            .mapToObj(number -> "project-%02d".formatted(number))
            .toList();
        when(persistence.findCashflowLedgerSource(eq("tenant-a"), anyString(), eq("2023-01"), anyString()))
            .thenAnswer(invocation -> {
                String projectId = invocation.getArgument(1);
                if ("project-07".equals(projectId)) {
                    throw new IllegalStateException("secret datastore path and credential");
                }
                return new WeeklyExpensePersistence.CashflowLedgerSource(List.of(), List.of(), List.of());
            });

        CashflowProjectionActualSummaryBatchResponse response = service.readCashflowProjectionActualSummaries(
            ACTOR, new CashflowProjectionActualSummaryBatchRequest(projectIds)
        );

        assertThat(response.version()).isEqualTo("1");
        assertThat(response.items()).hasSize(9)
            .extracting(CashflowProjectionActualSummaryBatchResponse.Item::projectId)
            .doesNotContain("project-07");
        assertThat(response.errors()).singleElement()
            .returns("project-07", CashflowProjectionActualSummaryBatchResponse.ErrorItem::projectId)
            .returns("SUMMARY_UNAVAILABLE", CashflowProjectionActualSummaryBatchResponse.ErrorItem::code);
        assertThat(new ObjectMapper().writeValueAsString(response))
            .doesNotContain("secret", "datastore", "credential", "IllegalStateException");
        for (String projectId : projectIds) {
            verify(authorization).requireProjectAllowed(
                WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, ACTOR, projectId
            );
        }
    }

    @Test
    void hidesWhichProjectWasForbiddenAndPerformsNoCanonicalRead() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = service(persistence, authorization);
        org.mockito.Mockito.doThrow(new WeeklyExpenseForbiddenException("Project does not exist."))
            .when(authorization).requireProjectAllowed(
                WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, ACTOR, "project-a"
            );

        assertThatThrownBy(() -> service.readCashflowProjectionActualSummaries(
            ACTOR, new CashflowProjectionActualSummaryBatchRequest(List.of("project-a", "project-b"))
        )).isInstanceOf(WeeklyExpenseForbiddenException.class)
            .hasMessage("One or more projects are not accessible.");

        verify(persistence, never()).findCashflowLedgerSource(anyString(), anyString(), anyString(), anyString());
        verify(authorization).requireProjectAllowed(
            WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, ACTOR, "project-b"
        );
    }

    @Test
    void rejectsDuplicateProjectIds() {
        WeeklyExpenseCommandService service = service(
            mock(WeeklyExpensePersistence.class), mock(WeeklyExpenseAuthorizationService.class)
        );
        assertThatThrownBy(() -> service.readCashflowProjectionActualSummaries(
            ACTOR, new CashflowProjectionActualSummaryBatchRequest(List.of("project-a", "project-a"))
        )).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void directSummaryFromTheDashboardSourceMatchesTheBatchSummary() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = service(persistence, authorization);
        WeeklyExpenseProjectionEntity projection = new WeeklyExpenseProjectionEntity(
            "tenant-a", "project-a", "2023-01", 1, "SALES_IN"
        );
        projection.setAmount(BigDecimal.TEN);
        WeeklyExpensePersistence.CashflowLedgerSource source =
            new WeeklyExpensePersistence.CashflowLedgerSource(List.of(projection), List.of(), List.of(2023));
        when(persistence.findCashflowLedgerSource(eq("tenant-a"), eq("project-a"), eq("2023-01"), anyString()))
            .thenReturn(source);

        CashflowProjectionActualSummaryBatchResponse.Item batch = service.readCashflowProjectionActualSummaries(
            ACTOR, new CashflowProjectionActualSummaryBatchRequest(List.of("project-a"))
        ).items().getFirst();

        assertThat(service.readCashflowProjectionActualSummary(ACTOR, "project-a", source)).isEqualTo(batch);
    }

    private static WeeklyExpenseCommandService service(
        WeeklyExpensePersistence persistence,
        WeeklyExpenseAuthorizationService authorization
    ) {
        return new WeeklyExpenseCommandService(persistence, authorization, new ObjectMapper(), false, "stage");
    }
}
