package dev.merryai.innerplatform.weekly.api;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CashflowSettlementStatusesBatchRequestTest {
    @Test
    void keepsInputOrderForOneHundredUniqueProjects() {
        List<String> projectIds = IntStream.rangeClosed(1, 100).mapToObj(index -> "project-" + index).toList();

        assertThat(new CashflowSettlementStatusesBatchRequest(projectIds, "2026-08").requireUniqueProjectIds())
            .containsExactlyElementsOf(projectIds);
    }

    @Test
    void rejectsDuplicateAndUnsafeProjects() {
        assertThatThrownBy(() -> new CashflowSettlementStatusesBatchRequest(
            List.of("duplicate", "duplicate"), "2026-08"
        ).requireUniqueProjectIds()).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CashflowSettlementStatusesBatchRequest(
            List.of("unsafe/project"), "2026-08"
        ).requireUniqueProjectIds()).isInstanceOf(IllegalArgumentException.class);
    }
}
