package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportBatchEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WeeklyExpenseBankImportBatchRepository extends JpaRepository<WeeklyExpenseBankImportBatchEntity, String> {
}
