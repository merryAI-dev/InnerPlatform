package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseEditLeaseException;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

class WeeklyExpenseCommandLeaseCoverageTest {
    @Test
    void everyWeeklyFinanceMutationRequiresTheProjectCashflowLease() {
        WeeklyExpensePersistence persistence = org.mockito.Mockito.mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWriteLease(any(), anyString(), any()))
            .thenThrow(new WeeklyExpenseEditLeaseException(
                400,
                "cashflow_edit_lease_request_invalid",
                "Cashflow edit lease headers are required."
            ));
        WeeklyExpenseCommandService service = new WeeklyExpenseCommandService(
            persistence,
            new WeeklyExpenseAuthorizationService(
                (actor, projectId) -> true,
                (tenantId, projectId) -> true,
                "strict"
            ),
            new ObjectMapper(),
            true,
            "stage"
        );
        TrustedActorContext actor = new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm");
        CashflowEditSession missing = new CashflowEditSession("", "", "", 0);

        List<ThrowingCallable> commands = List.of(
            () -> service.saveDraft(actor, "project-a", "default", missing, null),
            () -> service.importBankStatementBatch(actor, "project-a", missing, null),
            () -> service.applyBankStatementItems(actor, "project-a", missing, null),
            () -> service.patchCells(actor, "project-a", "default", missing, null),
            () -> service.copyCells(actor, "project-a", "default", missing, null),
            () -> service.pasteCells(actor, "project-a", "default", missing, null),
            () -> service.cutCells(actor, "project-a", "default", missing, null),
            () -> service.insertRows(actor, "project-a", "default", missing, null),
            () -> service.deleteRows(actor, "project-a", "default", missing, null),
            () -> service.submitWeek(actor, "project-a", missing, null),
            () -> service.closeWeek(actor, "project-a", missing, null)
        );

        for (ThrowingCallable command : commands) {
            assertThatThrownBy(command)
                .isInstanceOf(WeeklyExpenseEditLeaseException.class)
                .extracting(error -> ((WeeklyExpenseEditLeaseException) error).code())
                .isEqualTo("cashflow_edit_lease_request_invalid");
        }
    }
}
