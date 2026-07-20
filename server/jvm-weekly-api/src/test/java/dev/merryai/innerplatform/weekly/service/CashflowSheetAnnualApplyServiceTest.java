package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CashflowEditSession;
import dev.merryai.innerplatform.weekly.api.CashflowSheetAnnualApplyRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSheetAnnualApplyResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CashflowSheetAnnualApplyServiceTest {
    private static final String SOURCE_REVISION = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final TrustedActorContext ACTOR = new TrustedActorContext(
        "tenant-a", "pm-1", "pm@example.com", "pm"
    );
    private static final CashflowEditSession SESSION = new CashflowEditSession(
        "stage-data-project", "session-a", "lease-a", 7
    );

    @Test
    void appliesCompleteAnnualTotalsWhilePreservingEmptyAndExplicitZero() {
        WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
        when(persistence.requireCashflowWritePermission(ACTOR, "project-a")).thenReturn("pm");
        when(persistence.findIdempotency(any(), any(), any(), any())).thenReturn(Optional.empty());
        when(persistence.requireCashflowWriteLease(ACTOR, "project-a", SESSION)).thenReturn("pm");
        when(persistence.replaceCashflowSheetYearTotal(
            eq("tenant-a"), eq("project-a"), eq("cashflow-sheet-lab"), any()
        )).thenReturn(new WeeklyExpensePersistence.CashflowSheetAnnualReplacement(
            4,
            Map.of("MYSC_PREPAY_IN", BigDecimal.ZERO),
            Map.of("MYSC_PREPAY_IN", BigDecimal.valueOf(50)),
            states("VALUE"),
            states("VALUE")
        ));
        when(persistence.saveAuditEvent(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(persistence.saveIdempotency(any())).thenAnswer(invocation -> invocation.getArgument(0));
        CashflowSheetAnnualApplyRequest request = new CashflowSheetAnnualApplyRequest(
            "annual-apply-1", SOURCE_REVISION, 2025, 3, completeCells()
        );

        CashflowSheetAnnualApplyResponse response = service(persistence)
            .applyCashflowSheetAnnualTotal(ACTOR, "project-a", SESSION, request);

        assertThat(response.year()).isEqualTo(2025);
        assertThat(response.revision()).isEqualTo(4);
        assertThat(response.projection()).containsEntry("MYSC_PREPAY_IN", BigDecimal.ZERO);
        verify(persistence).replaceCashflowSheetYearTotal(
            "tenant-a", "project-a", "cashflow-sheet-lab", request
        );
    }

    private static List<CashflowSheetAnnualApplyRequest.Cell> completeCells() {
        List<CashflowSheetAnnualApplyRequest.Cell> cells = new ArrayList<>();
        for (String mode : List.of("projection", "actual")) {
            for (String lineId : CashflowLineCatalog.ALL_LINES) {
                boolean explicitValue = "MYSC_PREPAY_IN".equals(lineId);
                cells.add(new CashflowSheetAnnualApplyRequest.Cell(
                    mode,
                    lineId,
                    explicitValue ? "VALUE" : "EMPTY",
                    explicitValue ? ("projection".equals(mode) ? BigDecimal.ZERO : BigDecimal.valueOf(50)) : null,
                    null,
                    lineId
                ));
            }
        }
        return cells;
    }

    private static Map<String, String> states(String prepayState) {
        Map<String, String> result = new LinkedHashMap<>();
        for (String lineId : CashflowLineCatalog.ALL_LINES) {
            result.put(lineId, "MYSC_PREPAY_IN".equals(lineId) ? prepayState : "EMPTY");
        }
        return result;
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
}
