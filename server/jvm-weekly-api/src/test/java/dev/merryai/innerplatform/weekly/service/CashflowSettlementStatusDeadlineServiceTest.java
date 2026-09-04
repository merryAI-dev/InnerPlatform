package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowSettlementStatusesBatchRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSettlementStatusesBatchResponse;
import dev.merryai.innerplatform.weekly.api.CashflowSettlementStatusesResponse;
import dev.merryai.innerplatform.weekly.api.TransitionCashflowSettlementStatusRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.domain.CashflowSettlementCyclePolicy;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 배선 검증. 규칙 자체는 {@code CashflowWeekDeadlineTest} 가 보지만, 서비스가 그 규칙을
 * 응답에 싣지 않으면 도메인 테스트가 전부 통과해도 화면에는 아무것도 도착하지 않는다.
 * 이 테스트가 없으면 {@code settlementStatusItem} 의 WEEK 분기를 되돌려도 아무 테스트도
 * 깨지지 않는다 - 사보타주 검증이 이 파일의 존재 이유다.
 */
class CashflowSettlementStatusDeadlineServiceTest {
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a", "viewer-a", "viewer@example.com", "viewer", "Viewer A"
    );

    private static WeeklyExpensePersistence.CashflowSettlementStatusRecord record(String period) {
        return new WeeklyExpensePersistence.CashflowSettlementStatusRecord(period, "COMPLETED", "", "", "", "", 1);
    }

    private static WeeklyExpensePersistence.CashflowSettlementStatusRecord record(String period, String status) {
        return new WeeklyExpensePersistence.CashflowSettlementStatusRecord(period, status, "", "", "", "", 1);
    }

    private static WeeklyExpensePersistence.CashflowSettlementCycleRecord cycle(
        String projectId,
        CashflowSettlementCyclePolicy.BusinessState businessState,
        CashflowSettlementCyclePolicy.Health health,
        List<WeeklyExpensePersistence.CashflowSettlementStatusRecord> settlements
    ) {
        return new WeeklyExpensePersistence.CashflowSettlementCycleRecord(
            projectId,
            "2026-08",
            "2026-07",
            settlements,
            settlements.stream().filter(item -> "MONTH".equals(item.period())).findFirst().orElse(null),
            new CashflowSettlementCyclePolicy.Projection(businessState, health, 1, null, ""),
            new WeeklyExpensePersistence.CashflowSettlementCycleAuthority(
                false, false, false, false, false
            )
        );
    }

    @Test
    void fillsWeeklyDeadlinesFromTheJvmRuleNotFromTheCaller() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence, authorization, new ObjectMapper(), false, "live"
        );
        when(persistence.findCashflowSettlementStatuses("tenant-a", "project-a", "2026-08"))
            .thenReturn(List.of(record("MONTH"), record("WEEK_1"), record("WEEK_2")));

        CashflowSettlementStatusesResponse response =
            service.readCashflowSettlementStatuses(ACTOR, "project-a", "2026-08");

        assertThat(response.items()).extracting(
            CashflowSettlementStatusesResponse.Item::period,
            CashflowSettlementStatusesResponse.Item::deadlineAt,
            CashflowSettlementStatusesResponse.Item::approverDeadlineAt
        ).containsExactly(
            // 월: 익월 11일 0시 KST / 승인은 그 달 말일까지.
            org.assertj.core.groups.Tuple.tuple("MONTH", "2026-09-10T15:00:00Z", "2026-09-30T15:00:00Z"),
            // 1주: 2026-08-01 이 토요일이라 목요일이 없는 부분 주. 주 마지막 날(8/2) 다음날 0시 KST.
            org.assertj.core.groups.Tuple.tuple("WEEK_1", "2026-08-02T15:00:00Z", "2026-08-03T04:00:00Z"),
            // 2주: 목요일(8/6) 자정 = 8/7 0시 KST(= 8/6 15:00Z), 승인은 +13시간 = 금 13:00 KST.
            org.assertj.core.groups.Tuple.tuple("WEEK_2", "2026-08-06T15:00:00Z", "2026-08-07T04:00:00Z")
        );
    }

    @Test
    void canonicalSingleReadUsesOnlyAHealthyFullCycleProjection() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence, authorization, new ObjectMapper(), false, "live"
        );
        List<WeeklyExpensePersistence.CashflowSettlementStatusRecord> healthySettlements = List.of(
            record("MONTH", "SUBMITTED"), record("WEEK_1", "COMPLETED")
        );
        when(persistence.findCashflowSettlementCyclesBatch(
            ACTOR, List.of("project-a"), "2026-08", "2026-07"
        )).thenReturn(Map.of(
            "project-a", cycle(
                "project-a",
                CashflowSettlementCyclePolicy.BusinessState.SUBMITTED,
                CashflowSettlementCyclePolicy.Health.OK,
                healthySettlements
            )
        ));

        CashflowSettlementStatusesResponse response =
            service.readCashflowSettlementStatuses(ACTOR, "project-a", "2026-08", true);

        assertThat(response.yearMonth()).isEqualTo("2026-08");
        assertThat(response.items()).extracting(
            CashflowSettlementStatusesResponse.Item::period,
            CashflowSettlementStatusesResponse.Item::status,
            CashflowSettlementStatusesResponse.Item::deadlineAt,
            CashflowSettlementStatusesResponse.Item::approverDeadlineAt
        ).containsExactly(
            org.assertj.core.groups.Tuple.tuple(
                "MONTH", "SUBMITTED", "2026-08-10T15:00:00Z", "2026-08-31T15:00:00Z"
            ),
            org.assertj.core.groups.Tuple.tuple(
                "WEEK_1", "COMPLETED", "2026-08-02T15:00:00Z", "2026-08-03T04:00:00Z"
            )
        );
        verify(persistence).findCashflowSettlementCyclesBatch(
            ACTOR, List.of("project-a"), "2026-08", "2026-07"
        );
        verify(persistence, never()).findCashflowSettlementStatuses("tenant-a", "project-a", "2026-08");

        when(persistence.findCashflowSettlementCyclesBatch(
            ACTOR, List.of("project-b"), "2026-08", "2026-07"
        )).thenReturn(Map.of(
            "project-b", cycle(
                "project-b",
                CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT,
                CashflowSettlementCyclePolicy.Health.OK,
                List.of(record("MONTH", "LOCKED"))
            )
        ));

        assertThatThrownBy(() -> service.readCashflowSettlementStatuses(
            ACTOR, "project-b", "2026-08", true
        )).isInstanceOf(WeeklyExpenseEditLeaseException.class)
            .extracting(error -> ((WeeklyExpenseEditLeaseException) error).code())
            .isEqualTo("cashflow_settlement_cycle_read_unavailable");
    }

    @Test
    void canonicalBatchReadReturnsStatusesOnlyForHealthyFullCycleProjections() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence, authorization, new ObjectMapper(), false, "live"
        );
        List<String> projectIds = List.of("project-a", "project-b", "project-c");
        when(persistence.findCashflowSettlementCyclesBatch(
            ACTOR, projectIds, "2026-08", "2026-07"
        )).thenReturn(Map.of(
            "project-a", cycle(
                "project-a",
                CashflowSettlementCyclePolicy.BusinessState.SUBMITTED,
                CashflowSettlementCyclePolicy.Health.OK,
                List.of(record("MONTH", "SUBMITTED"), record("WEEK_1", "COMPLETED"))
            ),
            "project-b", cycle(
                "project-b",
                CashflowSettlementCyclePolicy.BusinessState.INCONSISTENT,
                CashflowSettlementCyclePolicy.Health.OK,
                List.of(record("MONTH", "LOCKED"))
            )
        ));

        CashflowSettlementStatusesBatchResponse response = service.readCashflowSettlementStatusesBatch(
            ACTOR,
            new CashflowSettlementStatusesBatchRequest(projectIds, "2026-08"),
            true
        );

        assertThat(response.items()).singleElement().satisfies(item -> {
            assertThat(item.yearMonth()).isEqualTo("2026-08");
            assertThat(item.items()).extracting(
                CashflowSettlementStatusesResponse.Item::period,
                CashflowSettlementStatusesResponse.Item::status
            ).containsExactly(
                org.assertj.core.groups.Tuple.tuple("MONTH", "SUBMITTED"),
                org.assertj.core.groups.Tuple.tuple("WEEK_1", "COMPLETED")
            );
        });
        assertThat(response.errors()).extracting(
            CashflowSettlementStatusesBatchResponse.ErrorItem::projectId,
            CashflowSettlementStatusesBatchResponse.ErrorItem::code
        ).containsExactly(
            org.assertj.core.groups.Tuple.tuple("project-b", "STATUS_UNAVAILABLE"),
            org.assertj.core.groups.Tuple.tuple("project-c", "STATUS_UNAVAILABLE")
        );
        verify(persistence).findCashflowSettlementCyclesBatch(
            ACTOR, projectIds, "2026-08", "2026-07"
        );
        verify(persistence, never()).findCashflowSettlementStatusesBatch(
            "tenant-a", projectIds, "2026-08"
        );

        when(persistence.findCashflowSettlementCyclesBatch(
            ACTOR, projectIds, "2026-08", "2026-07"
        )).thenThrow(new IllegalStateException("cycle backend unavailable"));

        CashflowSettlementStatusesBatchResponse unavailable = service.readCashflowSettlementStatusesBatch(
            ACTOR,
            new CashflowSettlementStatusesBatchRequest(projectIds, "2026-08"),
            true
        );

        assertThat(unavailable.items()).isEmpty();
        assertThat(unavailable.errors()).extracting(
            CashflowSettlementStatusesBatchResponse.ErrorItem::projectId,
            CashflowSettlementStatusesBatchResponse.ErrorItem::code
        ).containsExactly(
            org.assertj.core.groups.Tuple.tuple("project-a", "STATUS_UNAVAILABLE"),
            org.assertj.core.groups.Tuple.tuple("project-b", "STATUS_UNAVAILABLE"),
            org.assertj.core.groups.Tuple.tuple("project-c", "STATUS_UNAVAILABLE")
        );
    }

    @Test
    void rejectsMonthAtTheSharedTransitionBoundaryBeforeAuthorizationOrPersistence() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence, authorization, new ObjectMapper(), false, "live"
        );

        assertThatThrownBy(() -> service.transitionCashflowSettlementStatus(
            ACTOR,
            "project-a",
            new TransitionCashflowSettlementStatusRequest("2026-08", "MONTH", "APPROVE")
        )).isInstanceOfSatisfying(
            CashflowSettlementCyclePolicy.Violation.class,
            error -> assertThat(error.reason())
                .isEqualTo(CashflowSettlementCyclePolicy.ViolationReason.MONTH_REQUIRES_CLOSE_WORKFLOW)
        );

        verify(persistence, never()).requireCashflowMonthClosePermission(ACTOR, "project-a");
        verify(persistence, never()).transitionCashflowSettlementStatus(
            ACTOR, "project-a", "2026-08", "MONTH", "APPROVE"
        );
    }
}
