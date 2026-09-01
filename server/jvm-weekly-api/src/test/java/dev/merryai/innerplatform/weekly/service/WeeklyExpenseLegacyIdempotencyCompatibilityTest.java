package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.module.SimpleModule;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowMonthCloseResponse;
import dev.merryai.innerplatform.weekly.api.CashflowOpeningBalancesResponse;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
import dev.merryai.innerplatform.weekly.api.CloseCashflowMonthRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthCloseState;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthReopenPolicy;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditEventEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import dev.merryai.innerplatform.weekly.service.command.CashflowMonthReopenCommands;
import dev.merryai.innerplatform.weekly.service.port.CashflowMonthReopenPort;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeeklyExpenseLegacyIdempotencyCompatibilityTest {
    private static final String TENANT_ID = "tenant-a";
    private static final String PROJECT_ID = "project-a";
    private static final String DATA_PROJECT_ID = "stage-data-project";
    private static final String YEAR_MONTH = "2026-07";
    private static final String CYCLE_YEAR_MONTH = "2026-08";
    private static final String MANIFEST_HASH = "sha256:" + "a".repeat(64);
    private static final TrustedActorContext ACTOR_A = new TrustedActorContext(
        TENANT_ID, "admin-a", "admin-a@example.com", "admin", "Admin A"
    );
    private static final TrustedActorContext ACTOR_B = new TrustedActorContext(
        TENANT_ID, "admin-b", "admin-b@example.com", "admin", "Admin B"
    );

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void replaysFrozenPreB7ReceiptWithoutRunningTheCommandAgain(LegacyCommand command) {
        Fixture fixture = fixture();
        Object request = legacyRequest(command, false);
        assertThat(writeJson(fixture.objectMapper(), legacyView(request)))
            .isEqualTo(command.frozenJson());
        assertThat(sha256(command.frozenJson())).isEqualTo(command.frozenHash());
        seedReceipt(fixture, command, request, command.frozenHash());

        CashflowMonthCloseResponse response = invoke(fixture.service(), command, ACTOR_A, request);

        assertThat(response.commandName()).isEqualTo(command.commandName());
        assertThat(response.revision()).isEqualTo(42);
        verifyNoCommandMutation(fixture.persistence(), command);
    }

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void replaysBothTransitionalActorEnvelopeOrdersForALegacyShapedRequest(LegacyCommand command) {
        Object request = legacyRequest(command, false);
        for (Object transitionalEnvelope : List.of(
            new OrderedActorBoundRequest(ACTOR_A.id(), request),
            new RequestFirstActorBoundRequest(request, ACTOR_A.id())
        )) {
            Fixture fixture = fixture();
            String transitionalActorHash = sha256(writeJson(fixture.objectMapper(), transitionalEnvelope));
            seedReceipt(fixture, command, request, transitionalActorHash);

            CashflowMonthCloseResponse response = invoke(fixture.service(), command, ACTOR_A, request);

            assertThat(response.commandName()).isEqualTo(command.commandName());
            verifyNoCommandMutation(fixture.persistence(), command);
        }
    }

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void rejectsChangedLegacyBodyAgainstAFrozenPreB7Receipt(LegacyCommand command) {
        Fixture fixture = fixture();
        Object original = legacyRequest(command, false);
        Object changed = legacyRequest(command, true);
        seedReceipt(fixture, command, original, command.frozenHash());

        assertThatThrownBy(() -> invoke(fixture.service(), command, ACTOR_A, changed))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("different request body");
        verifyNoCommandMutation(fixture.persistence(), command);
    }

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void savesNewLegacyShapedReceiptWithTheFrozenPreB7Hash(LegacyCommand command) {
        Fixture fixture = fixture();
        Object request = legacyRequest(command, false);
        allowCommandWrite(fixture, command, request);

        invoke(fixture.service(), command, ACTOR_A, request);

        ArgumentCaptor<WeeklyExpenseIdempotencyEntity> receipt =
            ArgumentCaptor.forClass(WeeklyExpenseIdempotencyEntity.class);
        verify(fixture.persistence()).saveIdempotency(receipt.capture());
        assertThat(receipt.getValue().getRequestHash()).isEqualTo(command.frozenHash());
    }

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void keepsSettlementCycleReceiptBoundToTheWritingActor(LegacyCommand command) {
        Fixture fixture = fixture();
        Object request = settlementCycleRequest(command);
        allowCommandWrite(fixture, command, request);

        invoke(fixture.service(), command, ACTOR_A, request);

        ArgumentCaptor<WeeklyExpenseIdempotencyEntity> receipt =
            ArgumentCaptor.forClass(WeeklyExpenseIdempotencyEntity.class);
        verify(fixture.persistence()).saveIdempotency(receipt.capture());
        WeeklyExpenseIdempotencyEntity saved = receipt.getValue();
        when(fixture.persistence().findIdempotency(
            TENANT_ID, PROJECT_ID, command.commandName(), command.idempotencyKey()
        )).thenReturn(Optional.of(saved));

        assertThatThrownBy(() -> invoke(fixture.service(), command, ACTOR_B, request))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("different request body");
    }

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void actorBoundHashDoesNotDependOnMapIterationOrder(LegacyCommand command) {
        Fixture fixture = fixture(reverseMapEntriesObjectMapper());
        Object request = settlementCycleRequest(command);
        allowCommandWrite(fixture, command, request);

        invoke(fixture.service(), command, ACTOR_A, request);

        ArgumentCaptor<WeeklyExpenseIdempotencyEntity> receipt =
            ArgumentCaptor.forClass(WeeklyExpenseIdempotencyEntity.class);
        verify(fixture.persistence()).saveIdempotency(receipt.capture());
        String deterministicHash = sha256(writeJson(
            new ObjectMapper(), new OrderedActorBoundRequest(ACTOR_A.id(), request)
        ));
        assertThat(receipt.getValue().getRequestHash()).isEqualTo(deterministicHash);
    }

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void replaysRequestFirstTransitionalEnvelopeForSettlementCycleRequest(LegacyCommand command) {
        Fixture fixture = fixture();
        Object request = settlementCycleRequest(command);
        String transitionalHash = sha256(writeJson(
            fixture.objectMapper(), new RequestFirstActorBoundRequest(request, ACTOR_A.id())
        ));
        seedReceipt(fixture, command, request, transitionalHash);

        CashflowMonthCloseResponse response = invoke(fixture.service(), command, ACTOR_A, request);

        assertThat(response.commandName()).isEqualTo(command.commandName());
        verifyNoCommandMutation(fixture.persistence(), command);
    }

    @ParameterizedTest
    @EnumSource(LegacyCommand.class)
    void doesNotReplayPreB7HashWhenSettlementCycleFieldsArePresent(LegacyCommand command) {
        Fixture fixture = fixture();
        Object request = settlementCycleRequest(command);
        String legacyProjectionHash = sha256(writeJson(fixture.objectMapper(), legacyView(request)));
        seedReceipt(fixture, command, request, legacyProjectionHash);

        assertThatThrownBy(() -> invoke(fixture.service(), command, ACTOR_A, request))
            .isInstanceOf(WeeklyExpenseConflictException.class)
            .hasMessageContaining("different request body");
        verifyNoCommandMutation(fixture.persistence(), command);
    }

    private static Fixture fixture() {
        return fixture(new ObjectMapper());
    }

    private static Fixture fixture(ObjectMapper objectMapper) {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        WeeklyExpenseAuthorizationService authorization = mock(WeeklyExpenseAuthorizationService.class);
        when(persistence.requireCashflowMonthClosePermission(any(), eq(PROJECT_ID))).thenReturn("admin");
        when(persistence.findCashflowMonthReopenDecisionAuthorityFacts(any(), eq(PROJECT_ID)))
            .thenAnswer(invocation -> {
                CashflowMonthReopenPort.Actor actor = invocation.getArgument(0);
                return new CashflowMonthReopenPolicy.DecisionAuthorityFacts(
                    actor.tenantId(), actor.id(), PROJECT_ID, true, TENANT_ID, PROJECT_ID,
                    actor.id(), "ACTIVE", "admin", "organization-head", 1
                );
            });
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence, authorization, objectMapper, false, "live"
        );
        return new Fixture(persistence, service, objectMapper);
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static ObjectMapper reverseMapEntriesObjectMapper() {
        SimpleModule module = new SimpleModule();
        module.addSerializer((Class) Map.class, new ReverseMapEntriesSerializer());
        return new ObjectMapper().registerModule(module);
    }

    private static void seedReceipt(
        Fixture fixture,
        LegacyCommand command,
        Object request,
        String requestHash
    ) {
        WeeklyExpenseIdempotencyEntity receipt = new WeeklyExpenseIdempotencyEntity(
            TENANT_ID,
            PROJECT_ID,
            idempotencyKey(request),
            command.commandName(),
            requestHash,
            replayResponseJson(command.commandName())
        );
        when(fixture.persistence().findIdempotency(
            TENANT_ID, PROJECT_ID, command.commandName(), idempotencyKey(request)
        )).thenReturn(Optional.of(receipt));
    }

    private static void allowCommandWrite(Fixture fixture, LegacyCommand command, Object request) {
        when(fixture.persistence().findIdempotency(
            TENANT_ID, PROJECT_ID, command.commandName(), idempotencyKey(request)
        )).thenReturn(Optional.empty());
        when(fixture.persistence().saveAuditEvent(any(WeeklyExpenseAuditEventEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        when(fixture.persistence().saveIdempotency(any(WeeklyExpenseIdempotencyEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        CashflowMonthCloseState state = monthCloseState();
        switch (command) {
            case CLOSE -> when(fixture.persistence().closeCashflowMonth(
                any(), eq(PROJECT_ID), eq("cashflow-sheet-lab"), any(CloseCashflowMonthRequest.class)
            )).thenReturn(state);
            case REQUEST_REOPEN -> {
                CashflowMonthReopenCommands.RequestReopen reopen =
                    (CashflowMonthReopenCommands.RequestReopen) request;
                when(fixture.persistence().findCashflowMonthReopenFacts(TENANT_ID, PROJECT_ID, YEAR_MONTH))
                    .thenReturn(new CashflowMonthReopenPolicy.Facts(
                        false, "", "", 0, true, CashflowMonthReopenPolicy.State.CLOSED,
                        reopen.expectedRevision(), 0, 0, ""
                    ));
                when(fixture.persistence().applyCashflowMonthReopenRequest(
                    any(), eq(PROJECT_ID), any(), eq(reopen.reason()), any()
                )).thenReturn(state);
            }
            case DECIDE_REOPEN -> {
                CashflowMonthReopenCommands.DecideReopen reopen =
                    (CashflowMonthReopenCommands.DecideReopen) request;
                when(fixture.persistence().findCashflowMonthReopenFacts(TENANT_ID, PROJECT_ID, YEAR_MONTH))
                    .thenReturn(new CashflowMonthReopenPolicy.Facts(
                        false, "", "", 0, true, CashflowMonthReopenPolicy.State.REOPEN_REQUESTED,
                        reopen.expectedRevision(), 0, 0, ACTOR_A.id()
                    ));
                when(fixture.persistence().applyCashflowMonthReopenDecision(
                    any(), eq(PROJECT_ID), any(), eq(reopen.reason()), any()
                )).thenReturn(state);
            }
        }
    }

    private static CashflowMonthCloseResponse invoke(
        WeeklyExpenseCommandService service,
        LegacyCommand command,
        TrustedActorContext actor,
        Object request
    ) {
        return switch (command) {
            case CLOSE -> service.closeCashflowMonth(
                actor, PROJECT_ID, (CashflowEditSession) null, (CloseCashflowMonthRequest) request
            );
            case REQUEST_REOPEN -> service.requestCashflowMonthReopen(
                actor, PROJECT_ID, DATA_PROJECT_ID, (CashflowMonthReopenCommands.RequestReopen) request
            );
            case DECIDE_REOPEN -> service.decideCashflowMonthReopen(
                actor, PROJECT_ID, DATA_PROJECT_ID, (CashflowMonthReopenCommands.DecideReopen) request
            );
        };
    }

    private static Object legacyRequest(LegacyCommand command, boolean changed) {
        return switch (command) {
            case CLOSE -> closeRequest(command.idempotencyKey(), changed ? 8 : 7, false);
            case REQUEST_REOPEN -> new CashflowMonthReopenCommands.RequestReopen(
                command.idempotencyKey(), YEAR_MONTH, 8, changed ? "다른 정정 사유" : "정정 필요"
            );
            case DECIDE_REOPEN -> new CashflowMonthReopenCommands.DecideReopen(
                command.idempotencyKey(), YEAR_MONTH, 9, "APPROVE", changed ? "다른 검토 사유" : "검토 완료"
            );
        };
    }

    private static Object settlementCycleRequest(LegacyCommand command) {
        return switch (command) {
            case CLOSE -> closeRequest(command.idempotencyKey(), 7, true);
            case REQUEST_REOPEN -> new CashflowMonthReopenCommands.RequestReopen(
                command.idempotencyKey(), YEAR_MONTH, 8, "정정 필요", "cycle-request-reopen",
                CYCLE_YEAR_MONTH, YEAR_MONTH, 3, MANIFEST_HASH, 2
            );
            case DECIDE_REOPEN -> new CashflowMonthReopenCommands.DecideReopen(
                command.idempotencyKey(), YEAR_MONTH, 9, "APPROVE", "검토 완료", "cycle-decide-reopen",
                CYCLE_YEAR_MONTH, YEAR_MONTH, 3, MANIFEST_HASH, 2
            );
        };
    }

    private static CloseCashflowMonthRequest closeRequest(
        String idempotencyKey,
        long expectedRevision,
        boolean settlementCycle
    ) {
        return new CloseCashflowMonthRequest(
            idempotencyKey, "", "", YEAR_MONTH, expectedRevision, 3, true,
            List.of(), List.of(), List.of(), List.of(), List.of(), null,
            new CloseCashflowMonthRequest.DeadlineSummary("", 0, 0, null),
            "legacy-close-request", 4, MANIFEST_HASH,
            settlementCycle ? CYCLE_YEAR_MONTH : "",
            settlementCycle ? YEAR_MONTH : "",
            settlementCycle ? 2 : 0,
            settlementCycle ? "승인" : ""
        );
    }

    private static Object legacyView(Object request) {
        if (request instanceof CloseCashflowMonthRequest value) {
            return new LegacyCloseCashflowMonthRequest(
                value.idempotencyKey(), value.sourceRevision(), value.targetRevision(), value.yearMonth(),
                value.expectedRevision(), value.expectedDraftRevision(), value.humanReviewed(),
                value.depositScheduleRows(), value.cells(), value.confirmations(), value.managementChecks(),
                value.managementConfirmations(), value.openingBalances(), value.deadlineSummary(),
                value.requestId(), value.requestRevision(), value.manifestHash()
            );
        }
        if (request instanceof CashflowMonthReopenCommands.RequestReopen value) {
            return new LegacyRequestReopen(
                value.idempotencyKey(), value.yearMonth(), value.expectedRevision(), value.reason()
            );
        }
        CashflowMonthReopenCommands.DecideReopen value =
            (CashflowMonthReopenCommands.DecideReopen) request;
        return new LegacyDecideReopen(
            value.idempotencyKey(), value.yearMonth(), value.expectedRevision(), value.decision(), value.reason()
        );
    }

    private static String idempotencyKey(Object request) {
        if (request instanceof CloseCashflowMonthRequest value) return value.idempotencyKey();
        if (request instanceof CashflowMonthReopenCommands.RequestReopen value) return value.idempotencyKey();
        return ((CashflowMonthReopenCommands.DecideReopen) request).idempotencyKey();
    }

    private static void verifyNoCommandMutation(WeeklyExpensePersistence persistence, LegacyCommand command) {
        verify(persistence, never()).saveAuditEvent(any(WeeklyExpenseAuditEventEntity.class));
        verify(persistence, never()).saveIdempotency(any(WeeklyExpenseIdempotencyEntity.class));
        switch (command) {
            case CLOSE -> verify(persistence, never()).closeCashflowMonth(
                any(), eq(PROJECT_ID), eq("cashflow-sheet-lab"), any(CloseCashflowMonthRequest.class)
            );
            case REQUEST_REOPEN -> verify(persistence, never()).applyCashflowMonthReopenRequest(
                any(), eq(PROJECT_ID), any(), any(), any()
            );
            case DECIDE_REOPEN -> verify(persistence, never()).applyCashflowMonthReopenDecision(
                any(), eq(PROJECT_ID), any(), any(), any()
            );
        }
    }

    private static CashflowMonthCloseState monthCloseState() {
        return new CashflowMonthCloseState(
            PROJECT_ID, YEAR_MONTH, "CLOSED", 10, 0, 0, 0, 0,
            "", "", "", "", "", false, Map.of(), MANIFEST_HASH, "",
            Map.of("requestId", "stored-request"), Map.of(), true, "2026-08-28", "",
            false, "2026-08-28T01:00:00Z", ACTOR_A.id(), ACTOR_A.name(), "", "", "", "", "", "", "", false
        );
    }

    private static String replayResponseJson(String commandName) {
        return "{\"ok\":true,\"commandName\":\"" + commandName
            + "\",\"projectId\":\"" + PROJECT_ID
            + "\",\"yearMonth\":\"" + YEAR_MONTH
            + "\",\"status\":\"CLOSED\",\"revision\":42,"
            + "\"lastAmendmentEvidence\":{},\"snapshot\":{},\"previousSnapshot\":{}}";
    }

    private static String writeJson(ObjectMapper objectMapper, Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException(error);
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))
            );
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private enum LegacyCommand {
        CLOSE(
            WeeklyExpenseCommandService.CLOSE_CASHFLOW_MONTH_COMMAND,
            "legacy-close-key",
            "{\"idempotencyKey\":\"legacy-close-key\",\"sourceRevision\":\"\",\"targetRevision\":\"\","
                + "\"yearMonth\":\"2026-07\",\"expectedRevision\":7,\"expectedDraftRevision\":3,"
                + "\"humanReviewed\":true,\"depositScheduleRows\":[],\"cells\":[],\"confirmations\":[],"
                + "\"managementChecks\":[],\"managementConfirmations\":[],\"openingBalances\":null,"
                + "\"deadlineSummary\":{\"trackingStartedAt\":\"\",\"missedCount\":0,\"completedCount\":0,"
                + "\"current\":null},\"requestId\":\"legacy-close-request\",\"requestRevision\":4,"
                + "\"manifestHash\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}",
            "d76b7004e144ff912126970f9781cd310ca48c9ac94a0223e8b69ef79bb7f697"
        ),
        REQUEST_REOPEN(
            WeeklyExpenseCommandService.REQUEST_CASHFLOW_MONTH_REOPEN_COMMAND,
            "legacy-request-reopen-key",
            "{\"idempotencyKey\":\"legacy-request-reopen-key\",\"yearMonth\":\"2026-07\","
                + "\"expectedRevision\":8,\"reason\":\"정정 필요\"}",
            "7c2976d847c2c67b9236637a4e6c650041b5bfacdd012acadbe4aea900897107"
        ),
        DECIDE_REOPEN(
            WeeklyExpenseCommandService.DECIDE_CASHFLOW_MONTH_REOPEN_COMMAND,
            "legacy-decide-reopen-key",
            "{\"idempotencyKey\":\"legacy-decide-reopen-key\",\"yearMonth\":\"2026-07\","
                + "\"expectedRevision\":9,\"decision\":\"APPROVE\",\"reason\":\"검토 완료\"}",
            "ecb89abe442cf12f49b3f863f07599fd78b74eb17a462490e893551177f36190"
        );

        private final String commandName;
        private final String idempotencyKey;
        private final String frozenJson;
        private final String frozenHash;

        LegacyCommand(String commandName, String idempotencyKey, String frozenJson, String frozenHash) {
            this.commandName = commandName;
            this.idempotencyKey = idempotencyKey;
            this.frozenJson = frozenJson;
            this.frozenHash = frozenHash;
        }

        String commandName() {
            return commandName;
        }

        String idempotencyKey() {
            return idempotencyKey;
        }

        String frozenJson() {
            return frozenJson;
        }

        String frozenHash() {
            return frozenHash;
        }
    }

    private record Fixture(
        WeeklyExpensePersistence persistence,
        WeeklyExpenseCommandService service,
        ObjectMapper objectMapper
    ) {
    }

    private record OrderedActorBoundRequest(String actorUid, Object request) {
    }

    private record RequestFirstActorBoundRequest(Object request, String actorUid) {
    }

    private static final class ReverseMapEntriesSerializer extends JsonSerializer<Map<?, ?>> {
        @Override
        public void serialize(
            Map<?, ?> value,
            JsonGenerator generator,
            SerializerProvider serializers
        ) throws IOException {
            List<Map.Entry<?, ?>> entries = new ArrayList<>(value.entrySet());
            entries.sort((left, right) -> String.valueOf(right.getKey()).compareTo(String.valueOf(left.getKey())));
            generator.writeStartObject();
            for (Map.Entry<?, ?> entry : entries) {
                generator.writeFieldName(String.valueOf(entry.getKey()));
                serializers.defaultSerializeValue(entry.getValue(), generator);
            }
            generator.writeEndObject();
        }
    }

    private record LegacyCloseCashflowMonthRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        String yearMonth,
        long expectedRevision,
        long expectedDraftRevision,
        boolean humanReviewed,
        List<CloseCashflowMonthRequest.DepositScheduleRow> depositScheduleRows,
        List<CashflowSheetLabApplyRequest.Cell> cells,
        List<CloseCashflowMonthRequest.Confirmation> confirmations,
        List<CloseCashflowMonthRequest.ManagementCheck> managementChecks,
        List<CloseCashflowMonthRequest.ManagementConfirmation> managementConfirmations,
        CashflowOpeningBalancesResponse openingBalances,
        CloseCashflowMonthRequest.DeadlineSummary deadlineSummary,
        String requestId,
        long requestRevision,
        String manifestHash
    ) {
    }

    private record LegacyRequestReopen(
        String idempotencyKey,
        String yearMonth,
        long expectedRevision,
        String reason
    ) {
    }

    private record LegacyDecideReopen(
        String idempotencyKey,
        String yearMonth,
        long expectedRevision,
        String decision,
        String reason
    ) {
    }
}
