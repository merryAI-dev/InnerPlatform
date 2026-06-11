package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FirestoreCashflowWeekActualMergeTest {
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
}
