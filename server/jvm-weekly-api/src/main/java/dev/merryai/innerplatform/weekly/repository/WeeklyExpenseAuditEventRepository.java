package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditEventEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WeeklyExpenseAuditEventRepository extends JpaRepository<WeeklyExpenseAuditEventEntity, String> {
    List<WeeklyExpenseAuditEventEntity> findByTenantIdAndProjectIdOrderByCreatedAtAsc(String tenantId, String projectId);
    List<WeeklyExpenseAuditEventEntity> findTop5ByTenantIdAndProjectIdOrderByCreatedAtDesc(String tenantId, String projectId);
}
