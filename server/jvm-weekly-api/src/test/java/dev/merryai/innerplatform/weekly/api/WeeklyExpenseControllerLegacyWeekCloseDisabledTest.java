package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.service.CashflowReadService;
import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import dev.merryai.innerplatform.weekly.service.query.CashflowDashboardSectionQueryService;
import dev.merryai.innerplatform.weekly.service.query.CashflowMonthDashboardQueryService;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class WeeklyExpenseControllerLegacyWeekCloseDisabledTest {
    private final WeeklyExpenseCommandService commandService = mock(WeeklyExpenseCommandService.class);
    private final WeeklyExpensePersistence persistence = mock(WeeklyExpensePersistence.class);
    private final CashflowReadService readService = new CashflowReadService(persistence);
    private final WeeklyExpenseController controller = new WeeklyExpenseController(
        commandService,
        readService,
        new CashflowMonthDashboardQueryService(
            readService,
            new CashflowDashboardSectionQueryService()
        ),
        false
    );

    @Test
    void rejectsLegacyWeeklySubmitBeforeRunningACommand() {
        assertThatThrownBy(() -> controller.submitWeek(
            "project-a", "tenant-a", "pm-a", "pm", "pm@example.com", null, null
        ))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> org.assertj.core.api.Assertions.assertThat(((ResponseStatusException) error).getStatusCode())
                .isEqualTo(HttpStatus.GONE));

        verifyNoInteractions(commandService, persistence);
    }

    @Test
    void rejectsLegacyWeeklyCloseBeforeRunningACommand() {
        assertThatThrownBy(() -> controller.closeWeek(
            "project-a", "tenant-a", "finance-a", "finance", "finance@example.com", null, null
        ))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> org.assertj.core.api.Assertions.assertThat(((ResponseStatusException) error).getStatusCode())
                .isEqualTo(HttpStatus.GONE));

        verifyNoInteractions(commandService, persistence);
    }
}
