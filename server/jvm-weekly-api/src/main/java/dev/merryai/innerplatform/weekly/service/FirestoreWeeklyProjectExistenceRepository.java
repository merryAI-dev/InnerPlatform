package dev.merryai.innerplatform.weekly.service;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.io.IOException;

@Repository
@ConditionalOnProperty(name = "weekly.storage-backend", havingValue = "firestore")
public class FirestoreWeeklyProjectExistenceRepository implements WeeklyProjectExistenceRepository {
    private final Firestore db;

    public FirestoreWeeklyProjectExistenceRepository(
        @Value("${weekly.firestore-project-id:}") String firestoreProjectId
    ) {
        String projectId = text(firestoreProjectId);
        if (projectId.isBlank()) {
            throw new IllegalStateException("weekly.firestore-project-id is required when weekly.storage-backend=firestore.");
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
    public boolean exists(String tenantId, String projectId) {
        String tenant = text(tenantId);
        String project = text(projectId);
        if (tenant.isBlank() || project.isBlank()) return false;
        try {
            return db.document("orgs/" + tenant + "/projects/" + project).get().get().exists();
        } catch (Exception error) {
            return false;
        }
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
