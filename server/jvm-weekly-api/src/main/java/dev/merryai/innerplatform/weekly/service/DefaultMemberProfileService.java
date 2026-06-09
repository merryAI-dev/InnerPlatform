package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.api.MemberProfileResponse;
import dev.merryai.innerplatform.weekly.api.MemberProfileSyncRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
@ConditionalOnExpression("'${weekly.member-profile-backend:jpa}' != 'firestore'")
public class DefaultMemberProfileService implements MemberProfileService {
    @Override
    public MemberProfileResponse syncMemberProfile(TrustedActorContext actor, MemberProfileSyncRequest request) {
        String now = Instant.now().toString();
        return new MemberProfileResponse(
            actor.id(),
            firstNonBlank(request == null ? "" : request.name(), actor.email(), "사용자"),
            actor.email(),
            normalizeRole(actor.role()),
            actor.tenantId(),
            text(request == null ? "" : request.department()),
            "ACTIVE",
            "",
            List.of(),
            Map.of(),
            Map.of(),
            text(request == null ? "" : request.avatarUrl()),
            now,
            now,
            now,
            text(request == null ? "" : request.defaultWorkspace()),
            text(request == null ? "" : request.lastWorkspace())
        );
    }

    private String normalizeRole(String value) {
        String normalized = text(value).toLowerCase();
        return normalized.isBlank() ? "pm" : normalized;
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            String text = text(value);
            if (!text.isBlank()) return text;
        }
        return "";
    }

    private String text(String value) {
        return value == null ? "" : value.trim();
    }
}
