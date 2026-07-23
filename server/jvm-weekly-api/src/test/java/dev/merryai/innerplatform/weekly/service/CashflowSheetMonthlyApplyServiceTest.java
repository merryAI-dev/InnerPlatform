package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowSheetBatchApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetBatchApplyResponse;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CashflowSheetMonthlyApplyServiceTest {
    private static final String SOURCE_REVISION = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String TARGET_REVISION = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a", "pm-1", "pm@example.com", "spoofed"
    );
    private static final CashflowEditSession SESSION = new CashflowEditSession(
        "stage-data-project", "session-a", "lease-a", 7
    );

    @Test
    void checksStoredPermissionThenReplayAndAppliesACompleteMonthWithoutLease() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(any(), any(), any(), any())).thenReturn(Optional.empty());
        when(persistence.replaceCashflowSheetMonth(
            eq("tenant-a"),
            eq("project-a"),
            eq("cashflow-sheet-lab"),
            eq("2026-07"),
            eq(TARGET_REVISION),
            any(),
            anyBoolean(),
            isNull(),
            eq(SOURCE_REVISION),
            eq("apply-month-1")
        )).thenReturn(new WeeklyExpensePersistence.CashflowSheetMonthReplacement(
            List.of(),
            List.of(),
            List.of(),
            TARGET_REVISION
        ));
        when(persistence.saveAuditEvent(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(persistence.saveIdempotency(any())).thenAnswer(invocation -> invocation.getArgument(0));
        WeeklyExpenseCommandService service = service(persistence);
        CashflowSheetLabApplyRequest request = request("apply-month-1", completeCells(5));

        CashflowSheetLabApplyResponse response = service.applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            request
        );

        assertThat(response.yearMonth()).isEqualTo("2026-07");
        assertThat(response.sourceRevision()).isEqualTo(SOURCE_REVISION);
        assertThat(response.targetRevision()).isEqualTo(TARGET_REVISION);
        assertThat(response.resultingTargetRevision()).isEqualTo(TARGET_REVISION);
        InOrder order = inOrder(persistence);
        order.verify(persistence).requireCashflowWritePermission(ACTOR, "project-a");
        order.verify(persistence).findIdempotency(
            "tenant-a", "project-a", WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, "apply-month-1"
        );
        order.verify(persistence).replaceCashflowSheetMonth(
            eq("tenant-a"),
            eq("project-a"),
            eq("cashflow-sheet-lab"),
            eq("2026-07"),
            eq(TARGET_REVISION),
            any(),
            eq(false),
            isNull(),
            eq(SOURCE_REVISION),
            eq("apply-month-1")
        );
    }

    @Test
    void forwardsAnExplicitInitialActualReplacementToPersistence() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(any(), any(), any(), any())).thenReturn(Optional.empty());
        when(persistence.replaceCashflowSheetMonth(
            eq("tenant-a"), eq("project-a"), eq("cashflow-sheet-lab"), eq("2026-07"), eq(TARGET_REVISION), any(),
            eq(true), isNull(), eq(SOURCE_REVISION), eq("apply-replace-all")
        )).thenReturn(new WeeklyExpensePersistence.CashflowSheetMonthReplacement(List.of(), List.of(), List.of(), TARGET_REVISION));
        when(persistence.saveAuditEvent(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(persistence.saveIdempotency(any())).thenAnswer(invocation -> invocation.getArgument(0));

        service(persistence).applyCashflowSheetLab(ACTOR, "project-a", SESSION, request("apply-replace-all", completeCells(5), true));

        verify(persistence).replaceCashflowSheetMonth(
            eq("tenant-a"), eq("project-a"), eq("cashflow-sheet-lab"), eq("2026-07"), eq(TARGET_REVISION), any(),
            eq(true), isNull(), eq(SOURCE_REVISION), eq("apply-replace-all")
        );
    }

    @Test
    void replaysAnExactFinalSaveAfterItsLeaseWasReleased() throws Exception {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        ObjectMapper objectMapper = new ObjectMapper();
        CashflowSheetLabApplyRequest request = request("apply-replay", completeCells(5));
        CashflowSheetLabApplyResponse savedResponse = new CashflowSheetLabApplyResponse(
            true,
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            "project-a",
            "cashflow-sheet-lab",
            "2026-07",
            SOURCE_REVISION,
            TARGET_REVISION,
            TARGET_REVISION,
            0,
            0,
            List.of(),
            List.of(),
            "audit-1"
        );
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(
            "tenant-a",
            "project-a",
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            "apply-replay"
        )).thenReturn(Optional.of(new WeeklyExpenseIdempotencyEntity(
            "tenant-a",
            "project-a",
            "apply-replay",
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            sha256(objectMapper.writeValueAsString(request)),
            objectMapper.writeValueAsString(savedResponse)
        )));

        CashflowSheetLabApplyResponse replay = service(persistence).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            request
        );

        assertThat(replay).isEqualTo(savedResponse);
        verify(persistence, never()).requireCashflowWriteLease(any(), any(), any());
        verify(persistence, never()).replaceCashflowSheetMonth(any(), any(), any(), any(), any(), any());
    }

    @Test
    void replaysTheExactBatchResponseForTheSameIdempotencyKeyAndRequest() throws Exception {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        ObjectMapper objectMapper = new ObjectMapper();
        CashflowSheetBatchApplyRequest request = new CashflowSheetBatchApplyRequest(
            "apply-batch-replay",
            SOURCE_REVISION,
            TARGET_REVISION,
            false,
            List.of(
                new CashflowSheetBatchApplyRequest.Month("2026-07", completeCells(5)),
                new CashflowSheetBatchApplyRequest.Month("2026-08", completeCells(5))
            )
        );
        CashflowSheetBatchApplyResponse savedResponse = new CashflowSheetBatchApplyResponse(
            true,
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            "project-a",
            "cashflow-sheet-lab",
            SOURCE_REVISION,
            TARGET_REVISION,
            TARGET_REVISION,
            160,
            160,
            List.of(),
            17,
            "audit-batch-1"
        );
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(
            "tenant-a",
            "project-a",
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            "apply-batch-replay"
        )).thenReturn(Optional.of(new WeeklyExpenseIdempotencyEntity(
            "tenant-a",
            "project-a",
            "apply-batch-replay",
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            sha256(objectMapper.writeValueAsString(request)),
            objectMapper.writeValueAsString(savedResponse)
        )));

        CashflowSheetBatchApplyResponse replay = service(persistence).applyCashflowSheetBatch(
            ACTOR,
            "project-a",
            SESSION,
            request
        );

        assertThat(replay).isEqualTo(savedResponse);
        verify(persistence, never()).replaceCashflowSheetMonths(any(), any(), any(), any(), any());
        verify(persistence, never()).saveAuditEvent(any());
        verify(persistence, never()).saveIdempotency(any());
    }

    @Test
    void rejectsAnIncompleteMonthBeforeLeaseOrCanonicalWrites() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(any(), any(), any(), any())).thenReturn(Optional.empty());
        List<CashflowSheetLabApplyRequest.Cell> incomplete = new ArrayList<>(completeCells(5));
        incomplete.remove(incomplete.size() - 1);

        assertThatThrownBy(() -> service(persistence).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            request("apply-incomplete", incomplete)
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("complete");

        verify(persistence, never()).requireCashflowWriteLease(any(), any(), any());
        verify(persistence, never()).replaceCashflowSheetMonth(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsAnyMonthOtherThanExactlyFiveWeeksBeforeLeaseOrCanonicalWrites() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(any(), any(), any(), any())).thenReturn(Optional.empty());

        for (int weekCount : List.of(1, 2, 4, 6)) {
            assertThatThrownBy(() -> service(persistence).applyCashflowSheetLab(
                ACTOR,
                "project-a",
                SESSION,
                request("apply-" + weekCount + "-weeks", completeCells(weekCount))
            ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("five weeks");
        }

        verify(persistence, never()).requireCashflowWriteLease(any(), any(), any());
        verify(persistence, never()).replaceCashflowSheetMonth(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsDuplicateCellsBeforeLeaseOrCanonicalWrites() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(any(), any(), any(), any())).thenReturn(Optional.empty());
        List<CashflowSheetLabApplyRequest.Cell> duplicate = new ArrayList<>(completeCells(5));
        duplicate.set(duplicate.size() - 1, duplicate.get(0));

        assertThatThrownBy(() -> service(persistence).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            request("apply-duplicate", duplicate)
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("duplicate");

        verify(persistence, never()).requireCashflowWriteLease(any(), any(), any());
        verify(persistence, never()).replaceCashflowSheetMonth(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsAmountsFirestoreCannotStoreExactlyBeforeLease() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(any(), any(), any(), any())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service(persistence).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            request("apply-fractional", cellsWithFirstAmount(new BigDecimal("1.5")))
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("whole won");
        assertThatThrownBy(() -> service(persistence).applyCashflowSheetLab(
            ACTOR,
            "project-a",
            SESSION,
            request("apply-overflow", cellsWithFirstAmount(new BigDecimal("9223372036854775808")))
        ))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("whole won");

        verify(persistence, never()).requireCashflowWriteLease(any(), any(), any());
        verify(persistence, never()).replaceCashflowSheetMonth(any(), any(), any(), any(), any(), any());
    }

    private static WeeklyExpenseCommandService service(WeeklyExpensePersistence persistence) {
        return new WeeklyExpenseCommandService(
            persistence,
            new WeeklyExpenseAuthorizationService((actor, projectId) -> true, canonicalProjectsExist(), "strict"),
            new ObjectMapper(),
            true,
            "stage"
        );
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

    private static CashflowSheetLabApplyRequest request(
        String idempotencyKey,
        List<CashflowSheetLabApplyRequest.Cell> cells
    ) {
        return request(idempotencyKey, cells, false);
    }

    private static CashflowSheetLabApplyRequest request(
        String idempotencyKey,
        List<CashflowSheetLabApplyRequest.Cell> cells,
        boolean replaceAllActualSources
    ) {
        return new CashflowSheetLabApplyRequest(
            idempotencyKey,
            SOURCE_REVISION,
            TARGET_REVISION,
            "2026-07",
            replaceAllActualSources,
            cells
        );
    }

    private static List<CashflowSheetLabApplyRequest.Cell> completeCells(int weekCount) {
        List<String> lineIds = CashflowLineCatalog.ALL_LINES.stream().sorted(Comparator.naturalOrder()).toList();
        List<CashflowSheetLabApplyRequest.Cell> cells = new ArrayList<>();
        for (int weekNo = 1; weekNo <= weekCount; weekNo += 1) {
            for (String mode : List.of("projection", "actual")) {
                for (String lineId : lineIds) {
                    cells.add(new CashflowSheetLabApplyRequest.Cell(
                        mode,
                        weekNo,
                        lineId,
                        "VALUE",
                        BigDecimal.valueOf(weekNo * 100L),
                        "D1",
                        lineId
                    ));
                }
            }
        }
        return cells;
    }

    private static List<CashflowSheetLabApplyRequest.Cell> cellsWithFirstAmount(BigDecimal amount) {
        List<CashflowSheetLabApplyRequest.Cell> cells = new ArrayList<>(completeCells(5));
        CashflowSheetLabApplyRequest.Cell first = cells.get(0);
        cells.set(0, new CashflowSheetLabApplyRequest.Cell(
            first.mode(),
            first.weekNo(),
            first.cashflowLine(),
            first.cellState(),
            amount,
            first.sourceCell(),
            first.sourceLabel()
        ));
        return cells;
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        return java.util.HexFormat.of().formatHex(digest);
    }
}
