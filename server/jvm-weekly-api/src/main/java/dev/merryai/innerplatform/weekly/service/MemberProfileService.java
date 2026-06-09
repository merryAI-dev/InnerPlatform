package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.api.MemberProfileResponse;
import dev.merryai.innerplatform.weekly.api.MemberProfileSyncRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;

public interface MemberProfileService {
    MemberProfileResponse syncMemberProfile(TrustedActorContext actor, MemberProfileSyncRequest request);
}
