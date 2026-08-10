package dev.merryai.innerplatform.weekly.domain;

/** Domain rule for the month settlement label shown across cashflow surfaces. */
public final class CashflowMonthSettlementLifecycle {
    private CashflowMonthSettlementLifecycle() {
    }

    public static String resolveMonthStatus(String persistedStatus, String monthCloseRequestStatus) {
        if ("APPROVED".equals(monthCloseRequestStatus)) return "COMPLETED";
        if ("PENDING".equals(monthCloseRequestStatus)
            || "APPROVING".equals(monthCloseRequestStatus)
            || "UNCERTAIN".equals(monthCloseRequestStatus)) {
            return "PENDING_APPROVAL";
        }
        return persistedStatus;
    }
}
