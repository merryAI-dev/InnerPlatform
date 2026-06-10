package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditExportEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WeeklyExpenseAuditExportRepository extends JpaRepository<WeeklyExpenseAuditExportEntity, String> {
}
