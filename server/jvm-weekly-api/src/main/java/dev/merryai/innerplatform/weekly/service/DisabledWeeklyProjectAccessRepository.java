package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

@Repository
@ConditionalOnProperty(name = "weekly.project-access-backend", havingValue = "disabled")
public class DisabledWeeklyProjectAccessRepository implements WeeklyProjectAccessRepository {
    @Override
    public boolean hasProjectAccess(TrustedActorContext actor, String projectId) {
        return true;
    }
}
