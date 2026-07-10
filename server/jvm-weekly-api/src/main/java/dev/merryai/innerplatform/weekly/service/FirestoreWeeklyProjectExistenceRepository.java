package dev.merryai.innerplatform.weekly.service;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import com.google.cloud.firestore.QuerySnapshot;
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
            if (canonicalProjectExists(tenant, project)) {
                return true;
            }
            return hasExistingProjectScopedData(tenant, project);
        } catch (Exception error) {
            return false;
        }
    }

    @Override
    public boolean existsCanonicalProject(String tenantId, String projectId) {
        String tenant = text(tenantId);
        String project = text(projectId);
        if (tenant.isBlank() || project.isBlank()) return false;
        try {
            return canonicalProjectExists(tenant, project);
        } catch (Exception error) {
            return false;
        }
    }

    private boolean canonicalProjectExists(String tenantId, String projectId) throws Exception {
        return db.document("orgs/" + tenantId + "/projects/" + projectId).get().get().exists();
    }

    private boolean hasExistingProjectScopedData(String tenantId, String projectId) throws Exception {
        if (hasDocumentInProjectSubcollection(tenantId, projectId, "expense_sheets")) return true;
        if (hasDocumentInProjectSubcollection(tenantId, projectId, "expense_intake")) return true;
        if (hasTopLevelProjectReference(tenantId, "cashflow_weeks", projectId)) return true;
        if (hasTopLevelProjectReference(tenantId, "weekly_api_audit_events", projectId)) return true;
        return hasTopLevelProjectReference(tenantId, "weekly_api_audit_exports", projectId);
    }

    private boolean hasDocumentInProjectSubcollection(String tenantId, String projectId, String collectionName) throws Exception {
        QuerySnapshot snap = db.collection("orgs/" + tenantId + "/projects/" + projectId + "/" + collectionName)
            .limit(1)
            .get()
            .get();
        return !snap.isEmpty();
    }

    private boolean hasTopLevelProjectReference(String tenantId, String collectionName, String projectId) throws Exception {
        QuerySnapshot snap = db.collection("orgs/" + tenantId + "/" + collectionName)
            .whereEqualTo("projectId", projectId)
            .limit(1)
            .get()
            .get();
        return !snap.isEmpty();
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
