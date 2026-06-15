package dev.merryai.innerplatform.weekly.service;

public interface WeeklyProjectExistenceRepository {
    boolean exists(String tenantId, String projectId);

    default boolean existsCanonicalProject(String tenantId, String projectId) {
        return false;
    }
}
