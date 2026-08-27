package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowWeeklyOverviewRequest;
import dev.merryai.innerplatform.weekly.api.CashflowWeeklyOverviewResponse;
import dev.merryai.innerplatform.weekly.api.CashflowSettlementStatusesResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.domain.CashflowLedgerSource;
import dev.merryai.innerplatform.weekly.domain.CashflowSettlementCyclePolicy;
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
        WeeklyExpensePersistence.CashflowSettlementStatusRecord completedWeek =
            new WeeklyExpensePersistence.CashflowSettlementStatusRecord("WEEK_5", "COMPLETED", "", "", "", "", 1);
        WeeklyExpensePersistence.CashflowSettlementStatusRecord pendingWeek =
            new WeeklyExpensePersistence.CashflowSettlementStatusRecord("WEEK_5", "PENDING_APPROVAL", "", "", "", "", 1);
        WeeklyExpensePersistence.CashflowSettlementStatusRecord completedJuly =
            new WeeklyExpensePersistence.CashflowSettlementStatusRecord(
                "MONTH", "COMPLETED", "2026-08-11T01:00:00Z", "PM A",
                "2026-08-14T01:00:00Z", "Head A", 2
            );
        WeeklyExpensePersistence.CashflowSettlementStatusRecord pendingJuly =
            new WeeklyExpensePersistence.CashflowSettlementStatusRecord(
                "MONTH", "PENDING_APPROVAL", "2026-08-12T01:00:00Z", "PM B", "", "", 1
            );
        when(persistence.findCashflowSettlementCyclesBatch(
            ACTOR, projectIds, "2026-08", "2026-07"
        )).thenReturn(Map.of(
            "project-a", new WeeklyExpensePersistence.CashflowSettlementCycleRecord(
                "project-a", "2026-08", "2026-07", List.of(completedWeek), completedJuly,
                new CashflowSettlementCyclePolicy.Projection(
                    CashflowSettlementCyclePolicy.BusinessState.APPROVED,
                    CashflowSettlementCyclePolicy.Health.OK,
                    2,
                    new CashflowSettlementCyclePolicy.ApprovalProvenance(
                        "2023-01", "2026-07", "2026-08", "approval-v1",
                        "project-a-2026-08", 1, "sha256:root"
                    ),
                    ""
                ),
                new WeeklyExpensePersistence.CashflowSettlementCycleAuthority(
                    false, true, true, false, true, false
                )
            ),
            "project-b", new WeeklyExpensePersistence.CashflowSettlementCycleRecord(
                "project-b", "2026-08", "2026-07", List.of(pendingWeek), pendingJuly,
                new CashflowSettlementCyclePolicy.Projection(
                    CashflowSettlementCyclePolicy.BusinessState.PENDING_APPROVAL,
                    CashflowSettlementCyclePolicy.Health.OK,
                    1,
                    null,
                    ""
                ),
                new WeeklyExpensePersistence.CashflowSettlementCycleAuthority(
                    false, true, true, true, false, false
                )
            )
        ));
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
        assertThat(response.items().get(0).settlementCycle().monthCloseTargetYearMonth()).isEqualTo("2026-07");
        assertThat(response.items().get(0).settlementCycle().businessState()).isEqualTo("APPROVED");
        assertThat(response.items().get(0).settlementCycle().monthCloseSettlement().approvedAt())
            .isEqualTo("2026-08-14T01:00:00Z");
        assertThat(response.items().get(1).settlementCycle().businessState()).isEqualTo("PENDING_APPROVAL");
        assertThat(response.items().get(0).settlementCycle().commandCapabilities()
            .get("REQUEST_MONTH_REOPEN").allowed()).isTrue();
        assertThat(response.items().get(0).settlementCycle().commandCapabilities()
            .get("APPROVE_MONTH_CLOSE").allowed()).isFalse();
        assertThat(response.items().get(1).settlementCycle().commandCapabilities()
            .get("APPROVE_MONTH_CLOSE").allowed()).isTrue();
        assertThat(response.items()).allSatisfy(item -> assertThat(item.settlementStatuses().items().getFirst())
            .extracting(
                CashflowSettlementStatusesResponse.Item::deadlineAt,
                CashflowSettlementStatusesResponse.Item::approverDeadlineAt
            )
            .containsExactly("2026-08-27T15:00:00Z", "2026-08-28T04:00:00Z"));
        assertThat(response.items()).allSatisfy(item -> assertThat(item.projectionActualSummary()).isNotNull());
        assertThat(response.errors()).isEmpty();
        verify(authorization).requireProjectsAllowedForCommands(
            List.of(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, WeeklyExpenseCommandService.CASHFLOW_MONTH_CLOSE_READ_COMMAND),
            ACTOR, projectIds
        );
        verify(persistence).findCashflowLedgerSources(anyString(), anyList(), anyString(), anyString());
        verify(persistence).findCashflowSettlementCyclesBatch(ACTOR, projectIds, "2026-08", "2026-07");
        verify(persistence, never()).findCashflowSettlementStatusesBatch(anyString(), anyList(), anyString());
    }
}
