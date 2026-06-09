package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.api.TrustedActorContext;

public interface WeeklyProjectAccessRepository {
    boolean hasProjectAccess(TrustedActorContext actor, String projectId);
}
