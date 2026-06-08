package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSheetEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.Optional;

public interface WeeklyExpenseSheetRepository extends JpaRepository<WeeklyExpenseSheetEntity, String> {
    Optional<WeeklyExpenseSheetEntity> findByTenantIdAndProjectIdAndSheetKey(String tenantId, String projectId, String sheetKey);

    @EntityGraph(attributePaths = "rows")
    Optional<WeeklyExpenseSheetEntity> findWithRowsByTenantIdAndProjectIdAndSheetKey(String tenantId, String projectId, String sheetKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @EntityGraph(attributePaths = "rows")
    Optional<WeeklyExpenseSheetEntity> findLockedByTenantIdAndProjectIdAndSheetKey(String tenantId, String projectId, String sheetKey);
}
