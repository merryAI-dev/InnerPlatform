package dev.merryai.innerplatform.weekly.service;

public interface WeeklyProjectExistenceRepository {
    boolean exists(String tenantId, String projectId);
}
