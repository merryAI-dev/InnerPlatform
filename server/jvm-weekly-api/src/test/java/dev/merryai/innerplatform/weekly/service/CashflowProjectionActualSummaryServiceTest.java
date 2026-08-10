package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.domain.CashflowCumulativeCloseHead;
import dev.merryai.innerplatform.weekly.domain.CashflowLedgerSource;
import dev.merryai.innerplatform.weekly.domain.CashflowOpeningBalance;
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
import java.util.Map;
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
    void authorizesAllProjectsBeforeOneBatchedMirrorAndLedgerRead() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = service(persistence, authorization);
        WeeklyExpenseProjectionEntity projection = new WeeklyExpenseProjectionEntity(
            "tenant-a", "project-a", "2023-01", 1, "SALES_IN"
        );
        projection.setAmount(BigDecimal.TEN);
        Map<String, Integer> weeklyYears = Map.of("project-a", 2026, "project-b", 2026);
        when(persistence.findCashflowDeclaredWeeklyYears("tenant-a", List.of("project-a", "project-b"))).thenReturn(weeklyYears);
        when(persistence.findCashflowLedgerSources(eq("tenant-a"), eq(weeklyYears), eq("2023-01"), anyString()))
            .thenReturn(Map.of(
                "project-a", new CashflowLedgerSource(List.of(projection), List.of()),
                "project-b", new CashflowLedgerSource(List.of(), List.of())
            ));

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
        order.verify(persistence).findCashflowDeclaredWeeklyYears("tenant-a", List.of("project-a", "project-b"));
        order.verify(persistence).findCashflowLedgerSources(
            "tenant-a", weeklyYears, "2023-01", response.items().getFirst().comparisonAsOfWeek().yearMonth()
        );
    }

    @Test
    void returnsTheRequestedMonthAndWeekAmountsEvenWhenTheMonthIsAfterTheCurrentBoundary() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = service(persistence, authorization);
        WeeklyExpenseProjectionEntity projection = new WeeklyExpenseProjectionEntity(
            "tenant-a", "project-a", "2026-11", 2, "SALES_IN"
        );
        projection.setAmount(BigDecimal.valueOf(300));
        Map<String, Integer> weeklyYears = Map.of("project-a", 2026);
        when(persistence.findCashflowDeclaredWeeklyYears("tenant-a", List.of("project-a"))).thenReturn(weeklyYears);
        when(persistence.findCashflowLedgerSources("tenant-a", weeklyYears, "2023-01", "2026-11"))
            .thenReturn(Map.of("project-a", new CashflowLedgerSource(List.of(projection), List.of())));

        CashflowProjectionActualSummaryBatchResponse.Item item = service.readCashflowProjectionActualSummaries(
            ACTOR, new CashflowProjectionActualSummaryBatchRequest(List.of("project-a"), "2026-11")
        ).items().getFirst();

        assertThat(item.periods()).filteredOn(period -> period.period().equals("MONTH"))
            .extracting(CashflowProjectionActualSummaryBatchResponse.PeriodSummary::projectionAmount)
            .containsExactly(BigDecimal.valueOf(300));
        assertThat(item.periods()).filteredOn(period -> period.period().equals("WEEK_2"))
            .extracting(CashflowProjectionActualSummaryBatchResponse.PeriodSummary::projectionAmount)
            .containsExactly(BigDecimal.valueOf(300));
        verify(persistence).findCashflowLedgerSources("tenant-a", weeklyYears, "2023-01", "2026-11");
    }

    @Test
    void isolatesOneRepositoryFailureAcrossTenAuthorizedProjectsWithoutLeakingItsSecret() throws Exception {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = service(persistence, authorization);
        List<String> projectIds = IntStream.rangeClosed(1, 10)
            .mapToObj(number -> "project-%02d".formatted(number))
            .toList();
        Map<String, Integer> weeklyYears = projectIds.stream().collect(java.util.stream.Collectors.toMap(
            projectId -> projectId, ignored -> 2026
        ));
        Map<String, CashflowLedgerSource> sources = projectIds.stream()
            .filter(projectId -> !"project-07".equals(projectId))
            .collect(java.util.stream.Collectors.toMap(projectId -> projectId, ignored -> new CashflowLedgerSource(List.of(), List.of())));
        when(persistence.findCashflowDeclaredWeeklyYears("tenant-a", projectIds)).thenReturn(weeklyYears);
        when(persistence.findCashflowLedgerSources(eq("tenant-a"), eq(weeklyYears), eq("2023-01"), anyString()))
            .thenReturn(sources);

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

        verify(persistence, never()).findCashflowLedgerSources(
            anyString(), org.mockito.ArgumentMatchers.<String, Integer>anyMap(), anyString(), anyString()
        );
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
        CashflowLedgerSource source =
            new CashflowLedgerSource(List.of(projection), List.of());
        Map<String, Integer> weeklyYears = Map.of("project-a", 2026);
        when(persistence.findCashflowDeclaredWeeklyYears("tenant-a", List.of("project-a"))).thenReturn(weeklyYears);
        when(persistence.findCashflowLedgerSources(eq("tenant-a"), eq(weeklyYears), eq("2023-01"), anyString()))
            .thenReturn(Map.of("project-a", source));

        CashflowProjectionActualSummaryBatchResponse.Item batch = service.readCashflowProjectionActualSummaries(
            ACTOR, new CashflowProjectionActualSummaryBatchRequest(List.of("project-a"))
        ).items().getFirst();

        assertThat(service.readCashflowProjectionActualSummary(ACTOR, "project-a", source)).isEqualTo(batch);
    }

    private static WeeklyExpenseCommandService service(
        WeeklyExpensePersistence persistence,
        WeeklyExpenseAuthorizationService authorization
    ) {
        return new WeeklyExpenseCommandService(persistence, authorization, new ObjectMapper(), false, "live");
    }
}
