package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowAppliedCellChangesResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CashflowAppliedCellChangesServiceTest {
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a", "viewer-a", "viewer@example.com", "viewer", "Viewer A"
    );

    @Test
    void flattensAppliedChangesWithStableIdentityAndKeepsEmptyDistinctFromZero() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        when(persistence.findAppliedCellChangeAuditSources("tenant-a", "project-a")).thenReturn(List.of(
            source("event-old", "sheet-old", "weeklyExpense.projection.upsert", "actor-old", "old-key",
                "2026-07-30T01:00:00Z", """
                    {"actorEmail":"old@example.com","actorName":"Old Actor","appliedCellChanges":[
                      {"yearMonth":"2026-ANNUAL","weekNo":0,"mode":"projection","cashflowLine":"투자금",
                       "before":{"cellState":"VALUE","amount":100},"after":{"cellState":"EMPTY","amount":null},
                       "reason":"clear","sourceRevision":"r1","targetRevision":"r2","auditId":"audit-old"}
                    ]}
                    """),
            source("event-new", "sheet-new", "cashflowSheet.batch.apply", "actor-new", "new-key",
                "2026-07-30T02:00:00Z", """
                    {"actorEmail":"new@example.com","actorName":"New Actor","source":"monthly-shard",
                     "operationType":"BATCH_APPLY","operationId":"operation-new","appliedCellChanges":[
                      {"yearMonth":"2026-08","weekNo":1,"mode":"actual","cashflowLine":"매출",
                       "before":{"cellState":"EMPTY","amount":null},"after":{"cellState":"ZERO","amount":0},
                       "reason":"approved","sourceRevision":"r2","targetRevision":"r3","auditId":"audit-new",
                       "changedAt":"2026-07-30T02:00:01Z"},
                      {"yearMonth":"2026-08","weekNo":2,"mode":"projection","cashflowLine":"인건비",
                       "before":{"cellState":"ZERO","amount":0},"after":{"cellState":"VALUE","amount":5000},
                       "reason":"approved","sourceRevision":"r2","targetRevision":"r3","auditId":"audit-new"}
                    ]}
                    """)
        ));
        WeeklyExpenseCommandService service = service(persistence, authorization);

        CashflowAppliedCellChangesResponse first = service.readCashflowAppliedCellChanges(
            ACTOR, "project-a", 2, ""
        );

        assertThat(first.items()).hasSize(2);
        assertThat(first.nextCursor()).isNotBlank();
        assertThat(first.items().getFirst())
            .returns("event-new", CashflowAppliedCellChangesResponse.Item::eventId)
            .returns("event-new:0", CashflowAppliedCellChangesResponse.Item::cellId)
            .returns("project-a", CashflowAppliedCellChangesResponse.Item::projectId)
            .returns("2026-08", CashflowAppliedCellChangesResponse.Item::yearMonth)
            .returns(1, CashflowAppliedCellChangesResponse.Item::weekNo)
            .returns("actual", CashflowAppliedCellChangesResponse.Item::mode)
            .returns("매출", CashflowAppliedCellChangesResponse.Item::lineId)
            .returns(false, CashflowAppliedCellChangesResponse.Item::beforeHadValue)
            .returns("EMPTY", CashflowAppliedCellChangesResponse.Item::beforeState)
            .returns(null, CashflowAppliedCellChangesResponse.Item::beforeAmount)
            .returns(true, CashflowAppliedCellChangesResponse.Item::afterHadValue)
            .returns("ZERO", CashflowAppliedCellChangesResponse.Item::afterState)
            .returns(BigDecimal.ZERO, CashflowAppliedCellChangesResponse.Item::afterAmount)
            .returns("actor-new", CashflowAppliedCellChangesResponse.Item::actorUid)
            .returns("New Actor", CashflowAppliedCellChangesResponse.Item::actorName)
            .returns("new@example.com", CashflowAppliedCellChangesResponse.Item::actorEmail)
            .returns("approved", CashflowAppliedCellChangesResponse.Item::reason)
            .returns("monthly-shard", CashflowAppliedCellChangesResponse.Item::source)
            .returns("BATCH_APPLY", CashflowAppliedCellChangesResponse.Item::operationType)
            .returns("operation-new", CashflowAppliedCellChangesResponse.Item::operationId)
            .returns("audit-new", CashflowAppliedCellChangesResponse.Item::auditId)
            .returns("r2", CashflowAppliedCellChangesResponse.Item::sourceRevision)
            .returns("r3", CashflowAppliedCellChangesResponse.Item::targetRevision)
            .returns(Instant.parse("2026-07-30T02:00:01Z"), CashflowAppliedCellChangesResponse.Item::createdAt);

        CashflowAppliedCellChangesResponse second = service.readCashflowAppliedCellChanges(
            ACTOR, "project-a", 2, first.nextCursor()
        );
        assertThat(second.items()).singleElement()
            .returns("event-old:0", CashflowAppliedCellChangesResponse.Item::cellId)
            .returns("2026-ANNUAL", CashflowAppliedCellChangesResponse.Item::yearMonth)
            .returns(0, CashflowAppliedCellChangesResponse.Item::weekNo)
            .returns(true, CashflowAppliedCellChangesResponse.Item::beforeHadValue)
            .returns(false, CashflowAppliedCellChangesResponse.Item::afterHadValue)
            .returns(null, CashflowAppliedCellChangesResponse.Item::afterAmount);
        assertThat(second.nextCursor()).isEmpty();
        verify(authorization, org.mockito.Mockito.times(2)).requireProjectAllowed(
            WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, ACTOR, "project-a"
        );
        verify(persistence, org.mockito.Mockito.times(2))
            .findAppliedCellChangeAuditSources("tenant-a", "project-a");
    }

    @Test
    void validatesBoundedPagingAndRejectsUnknownCursor() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseCommandService service = service(persistence, mock(WeeklyExpenseAuthorizationService.class));
        when(persistence.findAppliedCellChangeAuditSources("tenant-a", "project-a")).thenReturn(List.of());

        assertThatThrownBy(() -> service.readCashflowAppliedCellChanges(ACTOR, "project-a", 0, ""))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.readCashflowAppliedCellChanges(ACTOR, "project-a", 101, ""))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.readCashflowAppliedCellChanges(ACTOR, "project-a", 50, "not-a-cursor"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private static WeeklyExpensePersistence.AppliedCellChangeAuditSource source(
        String eventId,
        String sheetKey,
        String commandName,
        String actorId,
        String idempotencyKey,
        String createdAt,
        String metadataJson
    ) {
        return new WeeklyExpensePersistence.AppliedCellChangeAuditSource(
            eventId, "project-a", sheetKey, commandName, actorId, idempotencyKey,
            metadataJson, Instant.parse(createdAt)
        );
    }

    private static WeeklyExpenseCommandService service(
        WeeklyExpensePersistence persistence,
        WeeklyExpenseAuthorizationService authorization
    ) {
        return new WeeklyExpenseCommandService(persistence, authorization, new ObjectMapper(), true, "live");
    }
}
