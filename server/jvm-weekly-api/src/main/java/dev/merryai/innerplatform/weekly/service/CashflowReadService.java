package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseWeeklyStatusEntity;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 컨트롤러의 읽기 경로가 통과하는 애플리케이션 서비스.
 *
 * <p>컨트롤러가 {@link WeeklyExpensePersistence} 를 직접 잡으면 api → storage 직행이 되어
 * 서비스 계층이 유지해야 할 공통 인터페이스(팀 원칙 C)가 사라진다 - 쓰기 경로는 전부
 * {@link WeeklyExpenseCommandService} 를 지나는데 읽기만 우회하고 있었다. 지금은 위임뿐이지만,
 * 읽기 정책(스코프, 열화, 캐시)이 생길 자리는 여기다.
 */
@Service
public class CashflowReadService {

    private final WeeklyExpensePersistence persistence;

    public CashflowReadService(WeeklyExpensePersistence persistence) {
        this.persistence = persistence;
    }

    public Integer declaredWeeklyYear(String tenantId, String projectId) {
        return persistence.findCashflowDeclaredWeeklyYear(tenantId, projectId);
    }

    public WeeklyExpensePersistence.CashflowLedgerSource ledgerSource(
        String tenantId,
        String projectId,
        Integer weeklyYear
    ) {
        return persistence.findCashflowLedgerSource(tenantId, projectId, weeklyYear);
    }

    public WeeklyExpensePersistence.CashflowLedgerSource globalLedgerSource(String tenantId, String projectId) {
        return persistence.findCashflowGlobalLedgerSource(tenantId, projectId);
    }

    public WeeklyExpensePersistence.CashflowOpeningBalance openingBalance(
        String tenantId,
        String projectId,
        int year
    ) {
        return persistence.findCashflowOpeningBalance(tenantId, projectId, year);
    }

    public WeeklyExpensePersistence.CashflowCumulativeCloseHead cumulativeCloseHead(
        String tenantId,
        String projectId
    ) {
        return persistence.findCashflowCumulativeCloseHead(tenantId, projectId);
    }

    public List<WeeklyExpenseWeeklyStatusEntity> weeklyStatuses(String tenantId, String projectId) {
        return persistence.findWeeklyStatuses(tenantId, projectId);
    }
}
