package dev.merryai.innerplatform.weekly.service;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.QuerySnapshot;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

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
    public Set<String> existingProjectIds(String tenantId, List<String> projectIds) {
        String tenant = text(tenantId);
        if (tenant.isBlank() || projectIds == null || projectIds.isEmpty()) return Set.of();
        try {
            DocumentReference[] refs = projectIds.stream()
                .map(projectId -> db.document("orgs/" + tenant + "/projects/" + text(projectId)))
                .toArray(DocumentReference[]::new);
            List<DocumentSnapshot> snapshots = db.getAll(refs).get();
            Set<String> result = new LinkedHashSet<>();
            Map<String, Future<Boolean>> legacyChecks = new LinkedHashMap<>();
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                for (int index = 0; index < projectIds.size(); index += 1) {
                    String projectId = text(projectIds.get(index));
                    if (snapshots.get(index).exists()) result.add(projectId);
                    else legacyChecks.put(projectId, executor.submit(() -> hasExistingProjectScopedData(tenant, projectId)));
                }
                for (Map.Entry<String, Future<Boolean>> entry : legacyChecks.entrySet()) {
                    if (entry.getValue().get()) result.add(entry.getKey());
                }
            }
            return Set.copyOf(result);
        } catch (Exception error) {
            return Set.of();
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
