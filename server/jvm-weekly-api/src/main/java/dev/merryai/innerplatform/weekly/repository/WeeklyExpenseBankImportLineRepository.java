package dev.merryai.innerplatform.weekly.repository;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportLineEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface WeeklyExpenseBankImportLineRepository extends JpaRepository<WeeklyExpenseBankImportLineEntity, String> {
    Optional<WeeklyExpenseBankImportLineEntity> findByTenantIdAndProjectIdAndSourceLineKey(
        String tenantId,
        String projectId,
        String sourceLineKey
    );

    @Query("""
        select line
        from WeeklyExpenseBankImportLineEntity line
        join fetch line.batch batch
        where line.tenantId = :tenantId
          and line.projectId = :projectId
          and (:status is null or line.status = :status)
        order by batch.createdAt desc, line.lineIndex asc, line.id asc
        """)
    List<WeeklyExpenseBankImportLineEntity> findByTenantIdAndProjectIdAndOptionalStatus(
        @Param("tenantId") String tenantId,
        @Param("projectId") String projectId,
        @Param("status") String status
    );

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        select line
        from WeeklyExpenseBankImportLineEntity line
        where line.tenantId = :tenantId
          and line.projectId = :projectId
          and line.id in :ids
        """)
    List<WeeklyExpenseBankImportLineEntity> findLockedByTenantIdAndProjectIdAndIdIn(
        @Param("tenantId") String tenantId,
        @Param("projectId") String projectId,
        @Param("ids") Collection<String> ids
    );
}
