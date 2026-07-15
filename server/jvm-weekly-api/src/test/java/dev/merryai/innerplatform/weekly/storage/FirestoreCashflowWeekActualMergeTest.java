package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FirestoreCashflowWeekActualMergeTest {
    @Test
    void includesDetailedPrepaymentLinesInActualTotals() {
        Map<String, Object> existing = Map.of(
            "weeklyExpenseActualBySheet", Map.of(
                "tab-2", Map.of("SALES_IN", 1000)
            )
        );

        Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
            "mysc",
            "project-a",
            "default",
            existing,
            List.of(
                new SaveDraftResponse.ActualDelta("2026-06", 1, "MYSC_PREPAY_LABOR_IN", new BigDecimal("100")),
                new SaveDraftResponse.ActualDelta("2026-06", 1, "MYSC_PREPAY_INPUT_VAT_IN", new BigDecimal("200")),
                new SaveDraftResponse.ActualDelta("2026-06", 1, "MYSC_PREPAY_DIRECT_OUT", new BigDecimal("30")),
                new SaveDraftResponse.ActualDelta("2026-06", 1, "MYSC_PREPAY_LABOR_OUT", new BigDecimal("40"))
            ),
            Instant.parse("2026-06-08T00:00:00Z")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> actual = (Map<String, Object>) patch.get("actual");
        @SuppressWarnings("unchecked")
        Map<String, Object> bySheet = (Map<String, Object>) patch.get("weeklyExpenseActualBySheet");

        assertThat(actual)
            .containsEntry("MYSC_PREPAY_LABOR_IN", 100L)
            .containsEntry("MYSC_PREPAY_INPUT_VAT_IN", 200L)
            .containsEntry("MYSC_PREPAY_DIRECT_OUT", 30L)
            .containsEntry("MYSC_PREPAY_LABOR_OUT", 40L)
            .containsEntry("SALES_IN", 1000L);
        assertThat(bySheet).containsKeys("default", "tab-2");
        assertThat(patch.get("actualTotals")).isEqualTo(Map.of("totalIn", 1300L, "totalOut", 70L, "net", 1230L));
    }

    @Test
    void replacesOnlyCurrentSheetContributionAndKeepsOtherSheets() {
        Map<String, Object> existing = Map.of(
            "weeklyExpenseActualBySheet", Map.of(
                "default", Map.of("DIRECT_COST_OUT", 1000),
                "tab-2", Map.of("DIRECT_COST_OUT", 2500, "SALES_IN", 10000)
            )
        );

        Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
            "mysc",
            "project-a",
            "default",
            existing,
            List.of(
                new SaveDraftResponse.ActualDelta("2026-06", 1, "DIRECT_COST_OUT", new BigDecimal("3000")),
                new SaveDraftResponse.ActualDelta("2026-06", 1, "INPUT_VAT_OUT", new BigDecimal("300"))
            ),
            Instant.parse("2026-06-08T00:00:00Z")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> actual = (Map<String, Object>) patch.get("actual");
        @SuppressWarnings("unchecked")
        Map<String, Object> bySheet = (Map<String, Object>) patch.get("weeklyExpenseActualBySheet");

        assertThat(actual).containsEntry("DIRECT_COST_OUT", 5500L);
        assertThat(actual).containsEntry("INPUT_VAT_OUT", 300L);
        assertThat(actual).containsEntry("SALES_IN", 10000L);
        assertThat(bySheet).containsKeys("default", "tab-2");
        assertThat(patch.get("actualTotals")).isEqualTo(Map.of("totalIn", 10000L, "totalOut", 5800L, "net", 4200L));
    }

    @Test
    void replacesAllActualSourcesOnlyWhenInitialLedgerOverwriteIsExplicit() {
        Map<String, Object> existing = Map.of(
            "weeklyExpenseActualBySheet", Map.of(
                "bank-import", Map.of("SALES_IN", 10000),
                "manual-entry", Map.of("DIRECT_COST_OUT", 2500)
            )
        );

        Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
            "mysc",
            "project-a",
            "cashflow-sheet",
            existing,
            List.of(new SaveDraftResponse.ActualDelta("2026-06", 1, "SALES_IN", new BigDecimal("3000"))),
            Instant.parse("2026-06-08T00:00:00Z"),
            true
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> bySheet = (Map<String, Object>) patch.get("weeklyExpenseActualBySheet");
        @SuppressWarnings("unchecked")
        Map<String, Object> actual = (Map<String, Object>) patch.get("actual");

        assertThat(bySheet).containsOnlyKeys("cashflow-sheet");
        assertThat(actual).containsExactly(Map.entry("SALES_IN", 3000L));
        assertThat(patch.get("actualTotals")).isEqualTo(Map.of("totalIn", 3000L, "totalOut", 0L, "net", 3000L));
    }

    @Test
    void removesCurrentSheetContributionWhenSheetNoLongerHasActualDeltas() {
        Map<String, Object> existing = Map.of(
            "weeklyExpenseActualBySheet", Map.of(
                "default", Map.of("DIRECT_COST_OUT", 1000),
                "tab-2", Map.of("SALES_IN", 7000)
            )
        );

        Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
            "mysc",
            "project-a",
            "default",
            existing,
            List.of(),
            Instant.parse("2026-06-08T00:00:00Z")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> actual = (Map<String, Object>) patch.get("actual");
        @SuppressWarnings("unchecked")
        Map<String, Object> bySheet = (Map<String, Object>) patch.get("weeklyExpenseActualBySheet");

        assertThat(actual).containsEntry("SALES_IN", 7000L);
        assertThat(actual).doesNotContainKey("DIRECT_COST_OUT");
        assertThat(bySheet).containsOnlyKeys("tab-2");
        assertThat(patch.get("actualTotals")).isEqualTo(Map.of("totalIn", 7000L, "totalOut", 0L, "net", 7000L));
    }

    @Test
    void replacesLegacyActualWithCurrentSheetContributionOnFirstJavaWrite() {
        Map<String, Object> existing = Map.of(
            "actual", Map.of(
                "DIRECT_COST_OUT", 2000,
                "SALES_IN", 9000
            )
        );

        Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
            "mysc",
            "project-a",
            "default",
            existing,
            List.of(new SaveDraftResponse.ActualDelta("2026-06", 1, "DIRECT_COST_OUT", new BigDecimal("500"))),
            Instant.parse("2026-06-08T00:00:00Z")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> actual = (Map<String, Object>) patch.get("actual");
        @SuppressWarnings("unchecked")
        Map<String, Object> bySheet = (Map<String, Object>) patch.get("weeklyExpenseActualBySheet");

        assertThat(bySheet).containsOnlyKeys("default");
        assertThat(actual).containsEntry("DIRECT_COST_OUT", 500L);
        assertThat(actual).doesNotContainKey("SALES_IN");
        assertThat(patch.get("actualTotals")).isEqualTo(Map.of("totalIn", 0L, "totalOut", 500L, "net", -500L));
    }

    @Test
    void ignoresLegacyActualWhenCurrentSheetHasNoDeltas() {
        Map<String, Object> existing = Map.of(
            "actual", Map.of(
                "DIRECT_COST_OUT", 2000,
                "SALES_IN", 9000
            )
        );

        Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
            "mysc",
            "project-a",
            "default",
            existing,
            List.of(),
            Instant.parse("2026-06-08T00:00:00Z")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> actual = (Map<String, Object>) patch.get("actual");
        @SuppressWarnings("unchecked")
        Map<String, Object> bySheet = (Map<String, Object>) patch.get("weeklyExpenseActualBySheet");

        assertThat(bySheet).isEmpty();
        assertThat(actual).isEmpty();
        assertThat(patch.get("actualTotals")).isEqualTo(Map.of("totalIn", 0L, "totalOut", 0L, "net", 0L));
    }

    @Test
    void preservesLargeFirestoreIntegersWithoutDoubleRounding() {
        long amount = 9_007_199_254_740_993L;

        Map<String, Object> patch = FirestoreCashflowWeekActualMerge.buildPatch(
            "mysc",
            "project-a",
            "default",
            Map.of("weeklyExpenseActualBySheet", Map.of("tab-2", Map.of("SALES_IN", amount))),
            List.of(),
            Instant.parse("2026-06-08T00:00:00Z")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> actual = (Map<String, Object>) patch.get("actual");
        assertThat(actual).containsEntry("SALES_IN", amount);
        assertThat(patch.get("actualTotals")).isEqualTo(Map.of(
            "totalIn", amount,
            "totalOut", 0L,
            "net", amount
        ));
    }

    @Test
    void rejectsFractionalAndOverflowingWonAmountsInsteadOfTruncating() {
        assertThatThrownBy(() -> FirestoreCashflowWeekActualMerge.numberMap(Map.of(
            "SALES_IN",
            new BigDecimal("1.5")
        )))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("whole won");

        assertThatThrownBy(() -> FirestoreCashflowWeekActualMerge.cashflowTotals(Map.of(
            "SALES_IN",
            BigDecimal.valueOf(Long.MAX_VALUE),
            "MYSC_PREPAY_LABOR_IN",
            BigDecimal.ONE
        )))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("supported range");
    }
}
