package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowWeeklyOverviewRequest;
import dev.merryai.innerplatform.weekly.api.CashflowWeeklyOverviewResponse;
import dev.merryai.innerplatform.weekly.api.CashflowSettlementStatusesResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.domain.CashflowLedgerSource;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CashflowWeeklyOverviewServiceTest {
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a", "viewer-a", "viewer@example.com", "viewer", "Viewer A"
    );

    @Test
    void combinesCanonicalStatusesAndSummariesInOneApplicationRead() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence, authorization, new ObjectMapper(), false, "live"
        );
        List<String> projectIds = List.of("project-a", "project-b");
        WeeklyExpensePersistence.CashflowSettlementStatusRecord completedMonth =
            new WeeklyExpensePersistence.CashflowSettlementStatusRecord("MONTH", "COMPLETED", "", "", "", "", 1);
        WeeklyExpensePersistence.CashflowSettlementStatusRecord pendingMonth =
            new WeeklyExpensePersistence.CashflowSettlementStatusRecord("MONTH", "PENDING_APPROVAL", "", "", "", "", 1);
        when(persistence.findCashflowSettlementStatusesBatch("tenant-a", projectIds, "2026-08"))
            .thenReturn(Map.of("project-a", List.of(completedMonth), "project-b", List.of(pendingMonth)));
        when(persistence.findCashflowLedgerSources(anyString(), anyList(), anyString(), anyString()))
            .thenReturn(Map.of(
                "project-a", new CashflowLedgerSource(List.of(), List.of()),
                "project-b", new CashflowLedgerSource(List.of(), List.of())
            ));

        CashflowWeeklyOverviewResponse response = service.readCashflowWeeklyOverview(
            ACTOR, new CashflowWeeklyOverviewRequest(projectIds, "2026-08")
        );

        assertThat(response.items()).hasSize(2);
        assertThat(response.items().get(0).settlementStatuses().items().getFirst().status()).isEqualTo("COMPLETED");
        assertThat(response.items().get(1).settlementStatuses().items().getFirst().status()).isEqualTo("PENDING_APPROVAL");
        verify(persistence, never()).findCashflowMonthCloseRequestStatusesBatch("tenant-a", projectIds, "2026-08");
        assertThat(response.items()).allSatisfy(item -> assertThat(item.settlementStatuses().items().getFirst())
            .extracting(
                CashflowSettlementStatusesResponse.Item::deadlineAt,
                CashflowSettlementStatusesResponse.Item::approverDeadlineAt
            )
            .containsExactly("2026-09-10T15:00:00Z", "2026-09-13T15:00:00Z"));
        assertThat(response.items()).allSatisfy(item -> assertThat(item.projectionActualSummary()).isNotNull());
        assertThat(response.errors()).isEmpty();
        verify(authorization).requireProjectsAllowedForCommands(
            List.of(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, WeeklyExpenseCommandService.CASHFLOW_MONTH_CLOSE_READ_COMMAND),
            ACTOR, projectIds
        );
        verify(persistence).findCashflowLedgerSources(anyString(), anyList(), anyString(), anyString());
    }
}
