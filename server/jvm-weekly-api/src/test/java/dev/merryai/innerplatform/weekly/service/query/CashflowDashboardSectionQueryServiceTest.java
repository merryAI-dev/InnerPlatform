package dev.merryai.innerplatform.weekly.service.query;

import dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseForbiddenException;
import dev.merryai.innerplatform.weekly.service.port.CashflowReadPort;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CashflowDashboardSectionQueryServiceTest {

    private final CashflowDashboardSectionQueryService service =
        new CashflowDashboardSectionQueryService();

    @Test
    void infrastructureReadFailureBecomesAnUnavailableSectionWithoutItsMessage() {
        CashflowDashboardSectionResult<String> result = service.read(
            "cashflow_section_unavailable",
            () -> {
                throw new CashflowReadPort.Unavailable(
                    new IllegalStateException("Firestore internal path and credentials")
                );
            }
        );

        assertThat(result.availability())
            .isEqualTo(CashflowDashboardSectionResult.Availability.UNAVAILABLE);
        assertThat(result.value()).isNull();
        assertThat(result.errorCode()).isEqualTo("cashflow_section_unavailable");
        assertThat(result.toString()).doesNotContain("Firestore", "credentials");
    }

    @Test
    void authorizationScopeAndBusinessConflictsRemainFailClosed() {
        assertThatThrownBy(() -> service.read(
            "cashflow_section_unavailable",
            () -> {
                throw new WeeklyExpenseForbiddenException("denied");
            }
        )).isInstanceOf(WeeklyExpenseForbiddenException.class);

        assertThatThrownBy(() -> service.read(
            "cashflow_section_unavailable",
            () -> {
                throw new WeeklyExpenseConflictException("contract changed");
            }
        )).isInstanceOf(WeeklyExpenseConflictException.class);

        assertThatThrownBy(() -> service.read(
            "cashflow_section_unavailable",
            () -> {
                throw new IllegalArgumentException("scope is invalid");
            }
        )).isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> service.read(
            "cashflow_section_unavailable",
            () -> {
                throw new IllegalStateException("programming error");
            }
        )).isInstanceOf(IllegalStateException.class);
    }
}
