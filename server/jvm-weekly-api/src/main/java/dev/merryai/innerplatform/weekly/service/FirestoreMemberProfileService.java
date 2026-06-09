package dev.merryai.innerplatform.weekly.service;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import com.google.cloud.firestore.SetOptions;
import dev.merryai.innerplatform.weekly.api.MemberProfileResponse;
import dev.merryai.innerplatform.weekly.api.MemberProfileSyncRequest;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutionException;

@Service
@ConditionalOnProperty(name = "weekly.member-profile-backend", havingValue = "firestore")
public class FirestoreMemberProfileService implements MemberProfileService {
    private final Firestore db;

    public FirestoreMemberProfileService(
        @Value("${weekly.firestore-project-id:}") String firestoreProjectId
    ) {
        String projectId = text(firestoreProjectId);
        if (projectId.isBlank()) {
            throw new IllegalStateException("weekly.firestore-project-id is required when weekly.member-profile-backend=firestore.");
        }
        try {
            this.db = FirestoreOptions.newBuilder()
                .setProjectId(projectId)
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .build()
                .getService();
        } catch (IOException error) {
            throw new IllegalStateException("Could not initialize Firestore credentials for member profile sync.", error);
        }
    }

    @Override
    public MemberProfileResponse syncMemberProfile(TrustedActorContext actor, MemberProfileSyncRequest request) {
        try {
            String tenantId = text(actor.tenantId());
            String uid = text(actor.id());
            String email = text(actor.email()).toLowerCase(Locale.ROOT);
            DocumentReference canonicalRef = db.document("orgs/" + tenantId + "/members/" + uid);
            DocumentReference legacyRef = legacyMemberRef(tenantId, email, uid);
            DocumentSnapshot canonicalSnap = canonicalRef.get().get();
            DocumentSnapshot legacySnap = legacyRef == null ? null : legacyRef.get().get();

            Map<String, Object> existing = mergeMemberSources(data(legacySnap), data(canonicalSnap));
            String now = Instant.now().toString();
            Map<String, Object> patch = new LinkedHashMap<>();
            patch.put("uid", uid);
            patch.put("name", firstNonBlank(request == null ? "" : request.name(), text(existing.get("name")), email, "사용자"));
            patch.put("email", firstNonBlank(email, text(existing.get("email"))));
            patch.put("role", normalizeStoredRole(text(existing.get("role"))));
            patch.put("tenantId", tenantId);
            patch.put("status", firstNonBlank(text(existing.get("status")), "ACTIVE"));
            patch.put("avatarUrl", firstNonBlank(request == null ? "" : request.avatarUrl(), text(existing.get("avatarUrl"))));
            patch.put("createdAt", firstNonBlank(text(existing.get("createdAt")), now));
            patch.put("updatedAt", now);
            patch.put("lastLoginAt", now);
            copyIfPresent(existing, patch, "department");
            copyIfPresent(existing, patch, "projectId");
            copyIfPresent(existing, patch, "projectIds");
            copyIfPresent(existing, patch, "projectNames");
            copyIfPresent(existing, patch, "portalProfile");

            if (request != null && !text(request.department()).isBlank()) {
                patch.put("department", text(request.department()));
            }
            if (request != null && !text(request.defaultWorkspace()).isBlank()) {
                patch.put("defaultWorkspace", text(request.defaultWorkspace()));
            } else {
                copyIfPresent(existing, patch, "defaultWorkspace");
            }
            if (request != null && !text(request.lastWorkspace()).isBlank()) {
                patch.put("lastWorkspace", text(request.lastWorkspace()));
            } else {
                copyIfPresent(existing, patch, "lastWorkspace");
            }

            canonicalRef.set(patch, SetOptions.merge()).get();
            return toResponse(tenantId, uid, patch);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Member profile sync was interrupted.", error);
        } catch (ExecutionException error) {
            throw new IllegalStateException("Member profile sync failed.", error.getCause() == null ? error : error.getCause());
        }
    }

    private DocumentReference legacyMemberRef(String tenantId, String email, String uid) {
        String legacyId = buildLegacyMemberDocId(email);
        if (legacyId.isBlank() || legacyId.equals(uid)) return null;
        return db.document("orgs/" + tenantId + "/members/" + legacyId);
    }

    private String buildLegacyMemberDocId(String email) {
        return text(email).replace("@", "_").replace(".", "_");
    }

    private Map<String, Object> data(DocumentSnapshot snap) {
        if (snap == null || !snap.exists() || snap.getData() == null) return Map.of();
        return snap.getData();
    }

    private Map<String, Object> mergeMemberSources(Map<String, Object> legacy, Map<String, Object> canonical) {
        Map<String, Object> merged = new LinkedHashMap<>();
        if (legacy != null) merged.putAll(legacy);
        if (canonical != null) merged.putAll(canonical);
        return merged;
    }

    private void copyIfPresent(Map<String, Object> source, Map<String, Object> target, String key) {
        Object value = source.get(key);
        if (value != null) {
            target.put(key, value);
        }
    }

    private MemberProfileResponse toResponse(String tenantId, String uid, Map<String, Object> data) {
        return new MemberProfileResponse(
            uid,
            text(data.get("name")),
            text(data.get("email")),
            normalizeStoredRole(text(data.get("role"))),
            tenantId,
            text(data.get("department")),
            firstNonBlank(text(data.get("status")), "ACTIVE"),
            text(data.get("projectId")),
            stringList(data.get("projectIds")),
            stringMap(data.get("projectNames")),
            objectMap(data.get("portalProfile")),
            text(data.get("avatarUrl")),
            text(data.get("createdAt")),
            text(data.get("updatedAt")),
            text(data.get("lastLoginAt")),
            text(data.get("defaultWorkspace")),
            text(data.get("lastWorkspace"))
        );
    }

    private List<String> stringList(Object value) {
        if (!(value instanceof Iterable<?> iterable)) return List.of();
        List<String> out = new ArrayList<>();
        for (Object item : iterable) {
            String text = text(item);
            if (!text.isBlank()) out.add(text);
        }
        return out;
    }

    private Map<String, String> stringMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) return Map.of();
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = text(entry.getKey());
            String entryValue = text(entry.getValue());
            if (!key.isBlank()) out.put(key, entryValue);
        }
        return out;
    }

    private Map<String, Object> objectMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) return Map.of();
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = text(entry.getKey());
            if (!key.isBlank()) out.put(key, normalizeFirestoreValue(entry.getValue()));
        }
        return out;
    }

    private Object normalizeFirestoreValue(Object value) {
        if (value instanceof Timestamp timestamp) {
            return timestamp.toDate().toInstant().toString();
        }
        return value;
    }

    private String normalizeStoredRole(String role) {
        String normalized = text(role).toLowerCase(Locale.ROOT);
        if (normalized.equals("viewer")) return "pm";
        if (normalized.equals("admin")
            || normalized.equals("tenant_admin")
            || normalized.equals("finance")
            || normalized.equals("pm")
            || normalized.equals("auditor")
            || normalized.equals("support")
            || normalized.equals("security")) {
            return normalized;
        }
        return "pm";
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            String text = text(value);
            if (!text.isBlank()) return text;
        }
        return "";
    }

    private String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
