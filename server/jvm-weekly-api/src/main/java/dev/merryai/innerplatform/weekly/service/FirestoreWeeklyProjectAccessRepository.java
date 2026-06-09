package dev.merryai.innerplatform.weekly.service;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import com.google.cloud.firestore.QuerySnapshot;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

@Repository
@ConditionalOnProperty(name = "weekly.project-access-backend", havingValue = "firestore", matchIfMissing = true)
public class FirestoreWeeklyProjectAccessRepository implements WeeklyProjectAccessRepository {
    private final Firestore db;

    public FirestoreWeeklyProjectAccessRepository(
        @Value("${weekly.firestore-project-id:}") String firestoreProjectId
    ) {
        String projectId = firestoreProjectId == null ? "" : firestoreProjectId.trim();
        if (projectId.isBlank()) {
            throw new IllegalStateException("weekly.firestore-project-id is required when weekly.project-access-backend=firestore.");
        }
        try {
            this.db = FirestoreOptions.newBuilder()
                .setProjectId(projectId)
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .build()
                .getService();
        } catch (IOException error) {
            throw new IllegalStateException("Could not initialize Firestore credentials.", error);
        }
    }

    @Override
    public boolean hasProjectAccess(TrustedActorContext actor, String projectId) {
        String targetProjectId = text(projectId);
        if (targetProjectId.isBlank()) return false;
        for (Map<String, Object> member : memberDocuments(actor)) {
            if (!isActiveActorMember(member, actor)) continue;
            if (projectIds(member).contains(targetProjectId)) {
                return true;
            }
        }
        return false;
    }

    private Set<Map<String, Object>> memberDocuments(TrustedActorContext actor) {
        Set<Map<String, Object>> results = new LinkedHashSet<>();
        String tenantId = text(actor.tenantId());
        if (tenantId.isBlank()) return results;
        try {
            String actorId = text(actor.id());
            if (!actorId.isBlank()) {
                DocumentSnapshot byId = db.document("orgs/" + tenantId + "/members/" + actorId).get().get();
                if (byId.exists()) {
                    results.add(byId.getData());
                }
            }
            String email = text(actor.email());
            if (!email.isBlank()) {
                QuerySnapshot byEmail = db.collection("orgs/" + tenantId + "/members")
                    .whereEqualTo("email", email)
                    .limit(3)
                    .get()
                    .get();
                for (DocumentSnapshot doc : byEmail.getDocuments()) {
                    if (doc.exists()) {
                        results.add(doc.getData());
                    }
                }
            }
            return results;
        } catch (Exception error) {
            return Set.of();
        }
    }

    private Set<String> projectIds(Map<String, Object> member) {
        Set<String> ids = new LinkedHashSet<>();
        addText(ids, member == null ? null : member.get("projectId"));
        addTextList(ids, member == null ? null : member.get("projectIds"));
        Object portalProfile = member == null ? null : member.get("portalProfile");
        if (portalProfile instanceof Map<?, ?> profile) {
            addText(ids, profile.get("projectId"));
            addTextList(ids, profile.get("projectIds"));
        }
        return ids;
    }

    private boolean isActiveActorMember(Map<String, Object> member, TrustedActorContext actor) {
        if (member == null) return false;
        if (!"ACTIVE".equals(text(member.get("status")).toUpperCase())) return false;
        String memberUid = text(member.get("uid"));
        return memberUid.isBlank() || memberUid.equals(text(actor.id()));
    }

    private void addText(Set<String> ids, Object value) {
        String text = text(value);
        if (!text.isBlank()) {
            ids.add(text);
        }
    }

    private void addTextList(Set<String> ids, Object value) {
        if (!(value instanceof Iterable<?> iterable)) return;
        for (Object item : iterable) {
            addText(ids, item);
        }
    }

    private String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
