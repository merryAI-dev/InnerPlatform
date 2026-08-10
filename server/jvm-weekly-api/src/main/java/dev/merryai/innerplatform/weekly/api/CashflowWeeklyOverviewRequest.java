package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CashflowWeeklyOverviewRequest(
    @NotNull @Size(min = 1, max = MAX_PROJECT_COUNT)
    List<@NotBlank @Size(max = MAX_PROJECT_ID_LENGTH) String> projectIds,
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth
) {
    public static final int MAX_PROJECT_COUNT = 100;
    public static final int MAX_PROJECT_ID_LENGTH = 120;

    public List<String> requireUniqueProjectIds() {
        List<String> normalized = projectIds == null
            ? List.of()
            : projectIds.stream().map(id -> id == null ? "" : id.trim()).toList();
        if (normalized.isEmpty() || normalized.size() > MAX_PROJECT_COUNT
            || normalized.stream().anyMatch(id -> id.isBlank() || id.length() > MAX_PROJECT_ID_LENGTH || id.contains("/"))
            || normalized.stream().distinct().count() != normalized.size()) {
            throw new IllegalArgumentException("projectIds must contain 1 to 100 unique safe project IDs.");
        }
        return normalized;
    }
}
