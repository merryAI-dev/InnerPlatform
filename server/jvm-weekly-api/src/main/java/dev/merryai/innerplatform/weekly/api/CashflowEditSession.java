package dev.merryai.innerplatform.weekly.api;

public record CashflowEditSession(
    String dataProjectId,
    String sessionId,
    String leaseId,
    long fence
) {
    public CashflowEditSession {
        dataProjectId = text(dataProjectId);
        sessionId = text(sessionId);
        leaseId = text(leaseId);
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }
}
