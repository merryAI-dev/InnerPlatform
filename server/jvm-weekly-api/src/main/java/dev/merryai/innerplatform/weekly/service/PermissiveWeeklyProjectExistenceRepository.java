package dev.merryai.innerplatform.weekly.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

@Repository
@ConditionalOnProperty(name = "weekly.storage-backend", havingValue = "jpa", matchIfMissing = true)
public class PermissiveWeeklyProjectExistenceRepository implements WeeklyProjectExistenceRepository {
    @Override
    public boolean exists(String tenantId, String projectId) {
        return projectId != null && !projectId.trim().isBlank();
    }
}
