package dev.merryai.innerplatform.weekly.api;

public record CreateFirebaseSessionResponse(
    boolean ok,
    String actorId,
    String tenantId,
    String actorRole,
    long expiresInSeconds
) {
}
