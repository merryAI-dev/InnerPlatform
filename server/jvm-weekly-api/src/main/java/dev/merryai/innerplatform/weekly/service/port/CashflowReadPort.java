package dev.merryai.innerplatform.weekly.service.port;

import dev.merryai.innerplatform.weekly.domain.CashflowCumulativeCloseHead;
import dev.merryai.innerplatform.weekly.domain.CashflowLedgerSource;
import dev.merryai.innerplatform.weekly.domain.CashflowMonthCloseState;
import dev.merryai.innerplatform.weekly.domain.CashflowOpeningBalance;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseWeeklyStatusEntity;

import java.util.List;

/** Application-owned read boundary for cashflow queries. */
public interface CashflowReadPort {
    Integer findCashflowDeclaredWeeklyYear(String tenantId, String projectId);

    CashflowLedgerSource findCashflowLedgerSource(String tenantId, String projectId, int weeklyYear);

    CashflowLedgerSource findCashflowLedgerSource(
        String tenantId,
        String projectId,
        int weeklyYear,
        String fromMonth,
        String throughMonth
    );

    CashflowLedgerSource findCashflowGlobalLedgerSource(String tenantId, String projectId);

    CashflowOpeningBalance findCashflowOpeningBalance(String tenantId, String projectId, int year);

    CashflowCumulativeCloseHead findCashflowCumulativeCloseHead(String tenantId, String projectId);

    CashflowMonthCloseState findCashflowMonthClose(String tenantId, String projectId, String yearMonth);

    List<WeeklyExpenseWeeklyStatusEntity> findWeeklyStatuses(String tenantId, String projectId);

    final class InvalidCumulativeCloseAuthority extends RuntimeException {
        public InvalidCumulativeCloseAuthority() {
            super("Canonical cumulative-close authority is invalid.");
        }
    }

    final class Unavailable extends RuntimeException {
        public Unavailable(Throwable cause) {
            super("Cashflow read port is unavailable.", cause);
        }
    }
}
