package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseWeeklyStatusEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WeeklyExpenseWeeklyStatusRepository extends JpaRepository<WeeklyExpenseWeeklyStatusEntity, String> {
    Optional<WeeklyExpenseWeeklyStatusEntity> findByTenantIdAndProjectIdAndYearMonthAndWeekNo(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo
    );

    List<WeeklyExpenseWeeklyStatusEntity> findByTenantIdAndProjectIdOrderByYearMonthDescWeekNoAsc(
        String tenantId,
        String projectId
    );
}
