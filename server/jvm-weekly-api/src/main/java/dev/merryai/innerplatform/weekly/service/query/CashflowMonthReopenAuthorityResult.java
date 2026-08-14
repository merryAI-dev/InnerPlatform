package dev.merryai.innerplatform.weekly.service.query;

public record CashflowMonthReopenAuthorityResult(
    String operationId,
    String projectId,
    Availability availability
) {
    public static CashflowMonthReopenAuthorityResult allowed(String commandName, String projectId) {
        return new CashflowMonthReopenAuthorityResult(commandName, projectId, Availability.ALLOWED);
    }

    public static CashflowMonthReopenAuthorityResult forbidden(String commandName, String projectId) {
        return new CashflowMonthReopenAuthorityResult(commandName, projectId, Availability.FORBIDDEN);
    }

    public static CashflowMonthReopenAuthorityResult unavailable(String commandName, String projectId) {
        return new CashflowMonthReopenAuthorityResult(commandName, projectId, Availability.UNAVAILABLE);
    }

    public enum Availability {
        ALLOWED,
        FORBIDDEN,
        UNAVAILABLE
    }
}
