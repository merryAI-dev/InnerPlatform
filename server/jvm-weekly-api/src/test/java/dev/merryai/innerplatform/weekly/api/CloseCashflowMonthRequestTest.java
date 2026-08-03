package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CloseCashflowMonthRequestTest {
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void cumulativeV2CompactContractDoesNotRequireLegacyOpeningBalances() {
        CloseCashflowMonthRequest request = compactCumulativeRequest();

        assertThat(request.cumulativeV2()).isTrue();
        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void contractValidationFlagIsNotPartOfTheJvmJsonPayload() throws Exception {
        String json = new ObjectMapper().writeValueAsString(compactCumulativeRequest());

        assertThat(json).doesNotContain("openingBalancesContractValid");
    }

    @Test
    void legacyContractStillRequiresOpeningBalances() {
        CloseCashflowMonthRequest request = new CloseCashflowMonthRequest(
            "legacy-close", "", "", "2026-01", 0, 0, true,
            List.of(), List.of(), List.of(), List.of(), List.of(), null, null
        );

        assertThat(request.cumulativeV2()).isFalse();
        assertThat(validator.validate(request))
            .extracting(violation -> violation.getPropertyPath().toString())
            .contains("openingBalancesContractValid");
    }

    @Test
    void monthCloseRejectsAnUnattestedHumanReview() {
        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireHumanReviewed(false))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("explicit human review");
    }

    @Test
    void managementConfirmationsMayBeEmptyAfterDesignatedApproval() {
        assertThat(CloseCashflowMonthRequest.requireCompleteManagementConfirmations(List.of())).isEmpty();
    }

    @Test
    void depositScheduleRejectsImpossibleCalendarDate() {
        List<CloseCashflowMonthRequest.DepositScheduleRow> rows = validNotApplicableRows();
        rows.set(0, new CloseCashflowMonthRequest.DepositScheduleRow(
            1,
            "2026-02-31",
            "",
            null,
            "",
            null,
            "NOT_APPLICABLE",
            "NOT_APPLICABLE"
        ));

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireCompleteDepositSchedule(rows))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("real YYYY-MM-DD date");
    }

    @Test
    void depositScheduleRejectsFractionalWonAmount() {
        List<CloseCashflowMonthRequest.DepositScheduleRow> rows = validNotApplicableRows();
        rows.set(0, new CloseCashflowMonthRequest.DepositScheduleRow(
            1,
            "2026-06-01",
            "2026-06-05",
            new BigDecimal("1000.5"),
            "",
            null,
            "NOT_APPLICABLE",
            "CONFIRMED"
        ));

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireCompleteDepositSchedule(rows))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("whole won value");
    }

    @Test
    void openingBalanceRejectsAChangedRowCompositionEvenWhenTheTotalIsUnchanged() {
        CashflowOpeningBalancesResponse.YearSource source = new CashflowOpeningBalancesResponse.YearSource(
            2025,
            Map.of("SALES_IN", new BigDecimal("2000000")),
            completeStates("SALES_IN")
        );
        CashflowOpeningBalancesResponse.Mode projection = new CashflowOpeningBalancesResponse.Mode(
            new BigDecimal("2000000"),
            Map.of("TEAM_SUPPORT_IN", new BigDecimal("2000000")),
            List.of(source),
            List.of(2025),
            List.of()
        );
        CashflowOpeningBalancesResponse openingBalances = new CashflowOpeningBalancesResponse(
            2026,
            projection,
            new CashflowOpeningBalancesResponse.Mode(BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of())
        );

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireOpeningBalances(openingBalances, "2026-01"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("rows do not match their annual sources");
    }

    @Test
    void openingBalanceRejectsAnAnnualSourceThatOmitsCanonicalRowStates() {
        CashflowOpeningBalancesResponse.YearSource source = new CashflowOpeningBalancesResponse.YearSource(
            2025,
            Map.of("SALES_IN", new BigDecimal("2000000")),
            Map.of("SALES_IN", "VALUE")
        );
        CashflowOpeningBalancesResponse.Mode projection = new CashflowOpeningBalancesResponse.Mode(
            new BigDecimal("2000000"),
            Map.of("SALES_IN", new BigDecimal("2000000")),
            List.of(source),
            List.of(2025),
            List.of()
        );
        CashflowOpeningBalancesResponse openingBalances = new CashflowOpeningBalancesResponse(
            2026,
            projection,
            new CashflowOpeningBalancesResponse.Mode(BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of())
        );

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireOpeningBalances(openingBalances, "2026-01"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("preserve every cashflow row state");
    }

    private static Map<String, String> completeStates(String valueLine) {
        Map<String, String> states = new LinkedHashMap<>();
        for (String line : dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog.ALL_LINES) {
            states.put(line, line.equals(valueLine) ? "VALUE" : "EMPTY");
        }
        return states;
    }

    private static CloseCashflowMonthRequest compactCumulativeRequest() {
        return new CloseCashflowMonthRequest(
            "cumulative-close",
            "",
            "",
            "2026-08",
            0,
            0,
            false,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "project-a-2026-08",
            2,
            "sha256:" + "a".repeat(64)
        );
    }

    private static List<CloseCashflowMonthRequest.DepositScheduleRow> validNotApplicableRows() {
        List<CloseCashflowMonthRequest.DepositScheduleRow> rows = new ArrayList<>();
        for (int weekNo = 1; weekNo <= CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT; weekNo += 1) {
            rows.add(new CloseCashflowMonthRequest.DepositScheduleRow(
                weekNo,
                "",
                "",
                null,
                "",
                null,
                "NOT_APPLICABLE",
                "NOT_APPLICABLE"
            ));
        }
        return rows;
    }
}
