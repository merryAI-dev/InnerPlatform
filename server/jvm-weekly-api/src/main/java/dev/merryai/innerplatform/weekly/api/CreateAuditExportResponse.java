package dev.merryai.innerplatform.weekly.api;

public record CreateAuditExportResponse(
    boolean ok,
    String commandName,
    String projectId,
    String artifactId,
    String artifactType,
    String fileName,
    String sha256,
    int projectionLineCount,
    int actualLineCount,
    int auditEventCount,
    String content,
    String auditId
) {
}
