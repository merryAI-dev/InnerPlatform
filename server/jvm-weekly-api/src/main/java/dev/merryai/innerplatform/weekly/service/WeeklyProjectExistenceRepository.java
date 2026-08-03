package dev.merryai.innerplatform.weekly.service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public interface WeeklyProjectExistenceRepository {
    boolean exists(String tenantId, String projectId);

    default Set<String> existingProjectIds(String tenantId, List<String> projectIds) {
        Set<String> result = new LinkedHashSet<>();
        for (String projectId : projectIds) {
            if (exists(tenantId, projectId)) result.add(projectId);
        }
        return Set.copyOf(result);
    }

    default boolean existsCanonicalProject(String tenantId, String projectId) {
        return false;
    }
}
