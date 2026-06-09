package dev.merryai.innerplatform.weekly.api;

import java.util.List;
import java.util.Map;

public record MemberProfileResponse(
    String uid,
    String name,
    String email,
    String role,
    String tenantId,
    String department,
    String status,
    String projectId,
    List<String> projectIds,
    Map<String, String> projectNames,
    Map<String, Object> portalProfile,
    String avatarUrl,
    String createdAt,
    String updatedAt,
    String lastLoginAt,
    String defaultWorkspace,
    String lastWorkspace
) {}
