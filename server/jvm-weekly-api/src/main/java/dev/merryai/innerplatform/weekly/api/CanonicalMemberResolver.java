package dev.merryai.innerplatform.weekly.api;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;
import java.util.Optional;

@Component
public class CanonicalMemberResolver {
    private final String firestoreProjectId;
    private volatile Firestore firestore;

    @Autowired
    public CanonicalMemberResolver(
        @Value("${weekly.firestore-project-id:}") String firestoreProjectId
    ) {
        this.firestoreProjectId = firestoreProjectId == null ? "" : firestoreProjectId.trim();
    }

    CanonicalMemberResolver(Firestore firestore) {
        this.firestoreProjectId = "";
        this.firestore = firestore;
    }

    public Optional<CanonicalMember> resolve(String tenantId, String actorId) {
        String tenant = requireDocumentId(tenantId, "tenantId");
        String actor = requireDocumentId(actorId, "actorId");
        try {
            DocumentSnapshot snapshot = firestore()
                .document("orgs/" + tenant + "/members/" + actor)
                .get()
                .get();
            if (!snapshot.exists()) return Optional.empty();
            Map<String, Object> data = snapshot.getData();
            Map<String, Object> member = data == null ? Map.of() : data;
            return Optional.of(new CanonicalMember(
                member.containsKey("status"),
                member.get("status"),
                member.get("role") instanceof String role ? role : ""
            ));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CanonicalMemberResolutionException("Canonical member lookup was interrupted.", error);
        } catch (Exception error) {
            throw new CanonicalMemberResolutionException("Canonical member lookup failed.", error);
        }
    }

    private Firestore firestore() {
        Firestore existing = firestore;
        if (existing != null) return existing;
        if (firestoreProjectId.isBlank()) {
            throw new CanonicalMemberResolutionException("weekly.firestore-project-id must be configured.");
        }
        synchronized (this) {
            if (firestore == null) {
                try {
                    firestore = FirestoreOptions.newBuilder()
                        .setProjectId(firestoreProjectId)
                        .setCredentials(GoogleCredentials.getApplicationDefault())
                        .build()
                        .getService();
                } catch (IOException error) {
                    throw new CanonicalMemberResolutionException("Could not initialize Firestore credentials.", error);
                }
            }
            return firestore;
        }
    }

    private String requireDocumentId(String value, String name) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isBlank() || normalized.contains("/")) {
            throw new CanonicalMemberResolutionException(name + " must be a Firestore document id.");
        }
        return normalized;
    }

    public record CanonicalMember(boolean statusPresent, Object status, String role) {
    }

    public static class CanonicalMemberResolutionException extends RuntimeException {
        CanonicalMemberResolutionException(String message) {
            super(message);
        }

        CanonicalMemberResolutionException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
