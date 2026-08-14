package dev.merryai.innerplatform.weekly.service.query;

public record CashflowDashboardSectionResult<T>(
    Availability availability,
    T value,
    String errorCode
) {
    public static <T> CashflowDashboardSectionResult<T> available(T value) {
        return new CashflowDashboardSectionResult<>(Availability.AVAILABLE, value, null);
    }

    public static <T> CashflowDashboardSectionResult<T> unavailable(String errorCode) {
        return new CashflowDashboardSectionResult<>(Availability.UNAVAILABLE, null, errorCode);
    }

    public boolean isAvailable() {
        return availability == Availability.AVAILABLE;
    }

    public enum Availability {
        AVAILABLE,
        UNAVAILABLE
    }
}
