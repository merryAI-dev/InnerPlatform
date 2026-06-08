package dev.merryai.innerplatform.weekly.api;

public record TrustedActorContext(
    String tenantId,
    String id,
    String email,
    String role
) {
    public TrustedActorContext {
        tenantId = requireText(tenantId, "x-tenant-id");
        id = requireText(id, "x-actor-id");
        email = email == null ? "" : email.trim().toLowerCase();
        role = role == null ? "" : role.trim().toLowerCase();
    }

    private static String requireText(String value, String headerName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(headerName + " is required");
        }
        return value.trim();
    }
}
