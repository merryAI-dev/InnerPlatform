package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CashflowProjectionActualSummaryBatchRequest(
    @NotNull @Size(min = 1, max = MAX_PROJECT_COUNT)
    List<@NotBlank @Size(max = MAX_PROJECT_ID_LENGTH) String> projectIds
) {
    public static final int MAX_PROJECT_COUNT = 10;
    public static final int MAX_PROJECT_ID_LENGTH = 120;

    public List<String> requireUniqueProjectIds() {
        List<String> normalized = projectIds == null
            ? List.of()
            : projectIds.stream().map(id -> id == null ? "" : id.trim()).sorted().toList();
        if (normalized.isEmpty() || normalized.size() > MAX_PROJECT_COUNT
            || normalized.stream().anyMatch(id -> id.isBlank() || id.length() > MAX_PROJECT_ID_LENGTH || id.contains("/"))
            || normalized.stream().distinct().count() != normalized.size()) {
            throw new IllegalArgumentException("projectIds must contain 1 to 10 unique safe project IDs.");
        }
        return normalized;
    }
}
