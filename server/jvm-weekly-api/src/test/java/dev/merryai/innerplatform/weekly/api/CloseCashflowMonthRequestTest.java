package dev.merryai.innerplatform.weekly.api;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CloseCashflowMonthRequestTest {
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
