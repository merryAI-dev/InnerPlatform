package dev.merryai.innerplatform.weekly.api;

import java.util.List;

public record UpsertProjectionResponse(
    boolean ok,
    String commandName,
    String projectId,
    int savedLineCount,
    List<CashflowSnapshotResponse.ProjectionLine> projection,
    String auditId
) {
}
