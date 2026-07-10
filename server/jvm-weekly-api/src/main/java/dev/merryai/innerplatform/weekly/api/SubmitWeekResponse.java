package dev.merryai.innerplatform.weekly.api;

public record SubmitWeekResponse(
    boolean ok,
    String commandName,
    String projectId,
    String yearMonth,
    int weekNo,
    String state,
    String auditId
) {
}
