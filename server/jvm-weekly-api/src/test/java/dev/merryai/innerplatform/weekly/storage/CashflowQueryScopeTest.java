package dev.merryai.innerplatform.weekly.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class CashflowQueryScopeTest {
    @Test
    void chunksAtFirestoreBoundaryWithoutDuplicates() {
        assertThat(CashflowQueryScope.FIRESTORE_WHERE_IN_LIMIT).isEqualTo(30);
        assertThat(CashflowQueryScope.chunks(months(29))).hasSize(1);
        assertThat(CashflowQueryScope.chunks(months(30))).hasSize(1);
        assertThat(CashflowQueryScope.chunks(months(31))).extracting(List::size).containsExactly(30, 1);
        assertThat(CashflowQueryScope.chunks(months(108))).hasSize(4);
        assertThat(CashflowQueryScope.chunks(List.of())).isEmpty();
        assertThat(CashflowQueryScope.chunks(java.util.Collections.nCopies(30, "2026-01")))
            .containsExactly(List.of("2026-01"));
    }

    @Test
    void validatesInputWithoutFallback() {
        for (String invalid : List.of("", "2026-13", "26-8", "2026-08-01", "x".repeat(100_000))) {
            assertThatThrownBy(() -> CashflowQueryScope.requireYearMonths(List.of(invalid)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("YYYY-MM");
        }
        assertThatThrownBy(() -> CashflowQueryScope.requireYearMonths(null))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> CashflowQueryScope.requireYearMonths(java.util.Collections.singletonList(null)))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void buildsInclusiveMonthRangeAndReturnsEmptyForReverseRange() {
        assertThat(CashflowQueryScope.between("2025-12", "2026-01"))
            .containsExactly("2025-12", "2026-01");
        assertThat(CashflowQueryScope.between("2026-02", "2026-01")).isEmpty();
    }

    private static List<String> months(int count) {
        List<String> values = new ArrayList<>();
        java.time.YearMonth month = java.time.YearMonth.of(2024, 1);
        for (int index = 0; index < count; index++) values.add(month.plusMonths(index).toString());
        return values;
    }
}
