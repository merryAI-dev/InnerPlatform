package dev.merryai.innerplatform.weekly.storage;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowCoordinatesTest {
    @Test
    void matchesTheBffCoordinateContract() {
        assertThat(CashflowCoordinates.weekOrdinal(2026, "2025-12", 4)).isEqualTo(-1);
        assertThat(CashflowCoordinates.weekOrdinal(2026, "2026-01", 1)).isZero();
        assertThat(CashflowCoordinates.weekOrdinal(2026, "2026-12", 5)).isEqualTo(59);
        assertThat(CashflowCoordinates.weekOrdinal(2026, "2026-03", 6)).isEqualTo(-1);
        assertThat(CashflowCoordinates.annualYearsFor(2026))
            .containsExactly(2024, 2025, 2027, 2028, 2029, 2030, 2031, 2032);
        assertThat(CashflowCoordinates.annualYearsFor(2027))
            .containsExactly(2025, 2026, 2028, 2029, 2030, 2031, 2032, 2033);
    }
}
