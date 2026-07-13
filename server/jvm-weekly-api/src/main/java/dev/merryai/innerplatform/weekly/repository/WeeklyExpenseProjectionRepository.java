package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseProjectionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WeeklyExpenseProjectionRepository extends JpaRepository<WeeklyExpenseProjectionEntity, String> {
    List<WeeklyExpenseProjectionEntity> findByTenantIdAndProjectId(String tenantId, String projectId);

    List<WeeklyExpenseProjectionEntity> findByTenantIdAndProjectIdOrderByYearMonthAscWeekNoAscCashflowLineAsc(
        String tenantId,
        String projectId
    );

    Optional<WeeklyExpenseProjectionEntity> findByTenantIdAndProjectIdAndYearMonthAndWeekNoAndCashflowLine(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo,
        String cashflowLine
    );
}
