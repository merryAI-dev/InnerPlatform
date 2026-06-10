package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseActualEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WeeklyExpenseActualRepository extends JpaRepository<WeeklyExpenseActualEntity, String> {
    Optional<WeeklyExpenseActualEntity> findByTenantIdAndProjectIdAndSheetKeyAndYearMonthAndWeekNoAndCashflowLine(
        String tenantId,
        String projectId,
        String sheetKey,
        String yearMonth,
        int weekNo,
        String cashflowLine
    );

    List<WeeklyExpenseActualEntity> findByTenantIdAndProjectId(String tenantId, String projectId);

    List<WeeklyExpenseActualEntity> findByTenantIdAndProjectIdOrderByYearMonthAscWeekNoAscSheetKeyAscCashflowLineAsc(
        String tenantId,
        String projectId
    );

    void deleteByTenantIdAndProjectIdAndSheetKey(String tenantId, String projectId, String sheetKey);
}
