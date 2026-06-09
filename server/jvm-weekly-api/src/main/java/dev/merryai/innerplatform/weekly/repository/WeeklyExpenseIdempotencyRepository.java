package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface WeeklyExpenseIdempotencyRepository extends JpaRepository<WeeklyExpenseIdempotencyEntity, String> {
    Optional<WeeklyExpenseIdempotencyEntity> findByTenantIdAndProjectIdAndCommandNameAndIdempotencyKey(
        String tenantId,
        String projectId,
        String commandName,
        String idempotencyKey
    );
}
