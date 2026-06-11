package dev.merryai.innerplatform.weekly.api;

public record VerifiedFirebaseActor(
    String tenantId,
    String actorId,
    String actorEmail,
    String actorRole,
    String actorName
) {
    public VerifiedFirebaseActor(String tenantId, String actorId, String actorEmail, String actorRole) {
        this(tenantId, actorId, actorEmail, actorRole, "");
    }

    public VerifiedFirebaseActor {
        tenantId = tenantId == null ? "" : tenantId.trim();
        actorId = requireText(actorId, "actorId");
        actorEmail = actorEmail == null ? "" : actorEmail.trim().toLowerCase();
        actorRole = actorRole == null ? "" : actorRole.trim().toLowerCase();
        actorName = actorName == null ? "" : actorName.trim();
    }

    private static String requireText(String value, String name) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException(name + " is required.");
        }
        return trimmed;
    }
}
