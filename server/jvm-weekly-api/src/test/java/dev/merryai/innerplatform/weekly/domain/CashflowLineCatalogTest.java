package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowLineCatalogTest {
    @Test
    void includesDetailedPrepaymentLinesInCanonicalDirections() {
        assertThat(CashflowLineCatalog.IN_LINES)
            .containsExactlyInAnyOrder(
                "MYSC_PREPAY_IN",
                "MYSC_PREPAY_LABOR_IN",
                "MYSC_PREPAY_INPUT_VAT_IN",
                "SALES_IN",
                "SALES_VAT_IN",
                "TEAM_SUPPORT_IN",
                "BANK_INTEREST_IN"
            );
        assertThat(CashflowLineCatalog.OUT_LINES)
            .containsExactlyInAnyOrder(
                "MYSC_PREPAY_DIRECT_OUT",
                "MYSC_PREPAY_LABOR_OUT",
                "DIRECT_COST_OUT",
                "INPUT_VAT_OUT",
                "MYSC_LABOR_OUT",
                "MYSC_PROFIT_OUT",
                "SALES_VAT_OUT",
                "TEAM_SUPPORT_OUT",
                "BANK_INTEREST_OUT"
            );
        assertThat(CashflowLineCatalog.ALL_LINES).hasSize(16);
    }

    @Test
    void canonicalizesCompactDetailedPrepaymentLabelsWithoutGuessingBareLabels() {
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-직접사업비등(입금)"))
            .isEqualTo("MYSC_PREPAY_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-MYSC인건비(입금)"))
            .isEqualTo("MYSC_PREPAY_LABOR_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-매입부가세(입금)"))
            .isEqualTo("MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-매입부가세"))
            .isEqualTo("MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-메입부가세"))
            .isEqualTo("MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-직접사업비등(출금)"))
            .isEqualTo("MYSC_PREPAY_DIRECT_OUT");
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-MYSC인건비(출금)"))
            .isEqualTo("MYSC_PREPAY_LABOR_OUT");
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-직접사업비등")).isBlank();
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금-MYSC인건비")).isBlank();
    }

    @Test
    void canonicalizesOnlyUnambiguousDetailedPrepaymentLabels() {
        assertThat(CashflowLineCatalog.canonicalize("MYSC_PREPAY_LABOR_IN"))
            .isEqualTo("MYSC_PREPAY_LABOR_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC_PREPAY_INPUT_VAT_IN"))
            .isEqualTo("MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC_PREPAY_DIRECT_OUT"))
            .isEqualTo("MYSC_PREPAY_DIRECT_OUT");
        assertThat(CashflowLineCatalog.canonicalize("MYSC_PREPAY_LABOR_OUT"))
            .isEqualTo("MYSC_PREPAY_LABOR_OUT");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - 직접사업비 등(입금)"))
            .isEqualTo("MYSC_PREPAY_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - MYSC 인건비(입금)"))
            .isEqualTo("MYSC_PREPAY_LABOR_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - 매입부가세(입금)"))
            .isEqualTo("MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - 매입부가세"))
            .isEqualTo("MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - 메입부가세"))
            .isEqualTo("MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - 직접사업비 등(출금)"))
            .isEqualTo("MYSC_PREPAY_DIRECT_OUT");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - MYSC 인건비(출금)"))
            .isEqualTo("MYSC_PREPAY_LABOR_OUT");
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - 직접사업비 등")).isBlank();
        assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - MYSC 인건비")).isBlank();
        assertThat(CashflowLineCatalog.canonicalize("MYSC선입금")).isEqualTo("MYSC_PREPAY_IN");
    }

    @Test
    void rejectsUnknownCashflowLinesInsteadOfPersistingCallerText() {
        assertThat(CashflowLineCatalog.canonicalize("UNREVIEWED_CALLER_LINE")).isBlank();
        assertThat(CashflowLineCatalog.canonicalize("매출액(입금)")).isEqualTo("SALES_IN");
    }

    @Test
    void monthCellCountIsTheSingleSourceForTheScattered160Literals() {
        // 애노테이션 상수(@Size 등)는 컴파일 상수여야 해서 리터럴로 남는다. 그 리터럴들이
        // 카탈로그 파생값과 같음을 여기서 고정한다 - 라인을 추가하면 이 테스트가 깨지면서
        // EXPECTED_CELL_COUNT 와 BFF 쪽 계약도 함께 갱신해야 함을 알린다.
        assertThat(CashflowLineCatalog.ALL_LINES).hasSize(16);
        assertThat(CashflowLineCatalog.monthCellCount()).isEqualTo(160);
        assertThat(
            dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT
        ).isEqualTo(CashflowLineCatalog.monthCellCount());
        assertThat(
            dev.merryai.innerplatform.weekly.api.CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT
        ).isEqualTo(CashflowLineCatalog.WEEKS_PER_MONTH);
    }
}
