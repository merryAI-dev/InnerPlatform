package dev.merryai.innerplatform.weekly.api;

public record VerifiedFirebaseActor(
    String tenantId,
    String actorId,
    String actorEmail,
    String actorRole
) {
    public VerifiedFirebaseActor {
        tenantId = requireText(tenantId, "tenantId");
        actorId = requireText(actorId, "actorId");
        actorEmail = actorEmail == null ? "" : actorEmail.trim().toLowerCase();
        actorRole = requireText(actorRole, "actorRole").toLowerCase();
    }

    private static String requireText(String value, String name) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException(name + " is required.");
        }
        return trimmed;
    }
}
