package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowLineCatalogTest {
    @Test
    void rejectsUnknownCashflowLinesInsteadOfPersistingCallerText() {
        assertThat(CashflowLineCatalog.canonicalize("UNREVIEWED_CALLER_LINE")).isBlank();
        assertThat(CashflowLineCatalog.canonicalize("매출액(입금)")).isEqualTo("SALES_IN");
    }
}
