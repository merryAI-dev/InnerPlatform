package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowLineCatalogTest {
    @Test
    void includesDetailedPrepaymentLinesInCanonicalDirections() {
        assertThat(CashflowLineCatalog.IN_LINES)
            .hasSize(7)
            .contains("MYSC_PREPAY_IN", "MYSC_PREPAY_LABOR_IN", "MYSC_PREPAY_INPUT_VAT_IN");
        assertThat(CashflowLineCatalog.OUT_LINES)
            .hasSize(9)
            .contains("MYSC_PREPAY_DIRECT_OUT", "MYSC_PREPAY_LABOR_OUT");
        assertThat(CashflowLineCatalog.ALL_LINES).hasSize(16);
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
