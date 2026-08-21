package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowSettlementStatusesResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
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
            // 월: 익월 11일 0시 KST / 승인 14일 0시 KST — 기존 동작 그대로.
            org.assertj.core.groups.Tuple.tuple("MONTH", "2026-09-10T15:00:00Z", "2026-09-13T15:00:00Z"),
            // 1주: 2026-08-01 이 토요일이라 목요일이 없는 부분 주. 주 마지막 날(8/2) 다음날 0시 KST.
            org.assertj.core.groups.Tuple.tuple("WEEK_1", "2026-08-02T15:00:00Z", "2026-08-03T04:00:00Z"),
            // 2주: 목요일(8/6) 자정 = 8/7 0시 KST(= 8/6 15:00Z), 승인은 +13시간 = 금 13:00 KST.
            org.assertj.core.groups.Tuple.tuple("WEEK_2", "2026-08-06T15:00:00Z", "2026-08-07T04:00:00Z")
        );
    }
}
