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
}
