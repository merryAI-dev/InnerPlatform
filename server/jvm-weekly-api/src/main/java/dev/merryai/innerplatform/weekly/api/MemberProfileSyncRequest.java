package dev.merryai.innerplatform.weekly.api;

public record MemberProfileSyncRequest(
    String name,
    String avatarUrl,
    String department,
    String defaultWorkspace,
    String lastWorkspace
) {}
