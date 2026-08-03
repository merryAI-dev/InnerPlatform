package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseActualEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditEventEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditExportEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportBatchEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportLineEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseProjectionEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSheetEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseWeeklyStatusEntity;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseActualRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseAuditEventRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseAuditExportRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseBankImportBatchRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseBankImportLineRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseIdempotencyRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseProjectionRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseSheetRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseWeeklyStatusRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;

@Repository
@ConditionalOnProperty(name = "weekly.storage-backend", havingValue = "jpa")
public class JpaWeeklyExpensePersistence implements WeeklyExpensePersistence {
    private final WeeklyExpenseSheetRepository sheetRepository;
    private final WeeklyExpenseIdempotencyRepository idempotencyRepository;
    private final WeeklyExpenseAuditEventRepository auditEventRepository;
    private final WeeklyExpenseActualRepository actualRepository;
    private final WeeklyExpenseProjectionRepository projectionRepository;
    private final WeeklyExpenseWeeklyStatusRepository weeklyStatusRepository;
    private final WeeklyExpenseAuditExportRepository auditExportRepository;
    private final WeeklyExpenseBankImportBatchRepository bankImportBatchRepository;
    private final WeeklyExpenseBankImportLineRepository bankImportLineRepository;

    public JpaWeeklyExpensePersistence(
        WeeklyExpenseSheetRepository sheetRepository,
        WeeklyExpenseIdempotencyRepository idempotencyRepository,
        WeeklyExpenseAuditEventRepository auditEventRepository,
        WeeklyExpenseActualRepository actualRepository,
        WeeklyExpenseProjectionRepository projectionRepository,
        WeeklyExpenseWeeklyStatusRepository weeklyStatusRepository,
        WeeklyExpenseAuditExportRepository auditExportRepository,
        WeeklyExpenseBankImportBatchRepository bankImportBatchRepository,
        WeeklyExpenseBankImportLineRepository bankImportLineRepository
    ) {
        this.sheetRepository = sheetRepository;
        this.idempotencyRepository = idempotencyRepository;
        this.auditEventRepository = auditEventRepository;
        this.actualRepository = actualRepository;
        this.projectionRepository = projectionRepository;
        this.weeklyStatusRepository = weeklyStatusRepository;
        this.auditExportRepository = auditExportRepository;
        this.bankImportBatchRepository = bankImportBatchRepository;
        this.bankImportLineRepository = bankImportLineRepository;
    }

    @Override
    @Transactional
    public <T> T runCommandTransaction(Callable<T> action) {
        return WeeklyExpensePersistence.super.runCommandTransaction(action);
    }

    @Override
    public Optional<WeeklyExpenseIdempotencyEntity> findIdempotency(
        String tenantId,
        String projectId,
        String commandName,
        String idempotencyKey
    ) {
        return idempotencyRepository.findByTenantIdAndProjectIdAndCommandNameAndIdempotencyKey(
            tenantId,
            projectId,
            commandName,
            idempotencyKey
        );
    }

    @Override
    public WeeklyExpenseIdempotencyEntity saveIdempotency(WeeklyExpenseIdempotencyEntity idempotency) {
        return idempotencyRepository.save(idempotency);
    }

    @Override
    public Optional<WeeklyExpenseSheetEntity> findSheetForUpdate(String tenantId, String projectId, String sheetKey) {
        return sheetRepository.findLockedByTenantIdAndProjectIdAndSheetKey(tenantId, projectId, sheetKey);
    }

    @Override
    public List<WeeklyExpenseSheetEntity> findSheets(String tenantId, String projectId) {
        return sheetRepository.findByTenantIdAndProjectIdOrderBySheetKeyAsc(tenantId, projectId);
    }

    @Override
    public WeeklyExpenseSheetEntity saveSheet(WeeklyExpenseSheetEntity sheet) {
        return sheetRepository.saveAndFlush(sheet);
    }

    @Override
    public void flushSheet(WeeklyExpenseSheetEntity sheet) {
        sheetRepository.saveAndFlush(sheet);
    }

    @Override
    public List<SaveDraftResponse.ActualDelta> replaceActuals(
        WeeklyExpenseSheetEntity sheet,
        List<SaveDraftResponse.ActualDelta> deltas
    ) {
        actualRepository.deleteByTenantIdAndProjectIdAndSheetKey(sheet.getTenantId(), sheet.getProjectId(), sheet.getSheetKey());
        List<SaveDraftResponse.ActualDelta> saved = new ArrayList<>();
        for (SaveDraftResponse.ActualDelta delta : deltas) {
            WeeklyExpenseActualEntity actual = actualRepository
                .findByTenantIdAndProjectIdAndSheetKeyAndYearMonthAndWeekNoAndCashflowLine(
                    sheet.getTenantId(),
                    sheet.getProjectId(),
                    sheet.getSheetKey(),
                    delta.yearMonth(),
                    delta.weekNo(),
                    delta.cashflowLine()
                )
                .orElseGet(() -> new WeeklyExpenseActualEntity(
                    sheet.getTenantId(),
                    sheet.getProjectId(),
                    sheet.getSheetKey(),
                    delta.yearMonth(),
                    delta.weekNo(),
                    delta.cashflowLine()
                ));
            actual.setAmount(delta.amount());
            WeeklyExpenseActualEntity savedActual = actualRepository.save(actual);
            saved.add(new SaveDraftResponse.ActualDelta(
                savedActual.getYearMonth(),
                savedActual.getWeekNo(),
                savedActual.getCashflowLine(),
                savedActual.getAmount()
            ));
        }
        return saved;
    }

    @Override
    public List<WeeklyExpenseActualEntity> replaceActualLines(
        String tenantId,
        String projectId,
        String sheetKey,
        List<SaveDraftResponse.ActualDelta> deltas
    ) {
        actualRepository.deleteByTenantIdAndProjectIdAndSheetKey(tenantId, projectId, sheetKey);
        List<WeeklyExpenseActualEntity> saved = new ArrayList<>();
        for (SaveDraftResponse.ActualDelta delta : deltas) {
            WeeklyExpenseActualEntity actual = new WeeklyExpenseActualEntity(
                tenantId,
                projectId,
                sheetKey,
                delta.yearMonth(),
                delta.weekNo(),
                delta.cashflowLine()
            );
            actual.setAmount(delta.amount());
            saved.add(actualRepository.save(actual));
        }
        return saved;
    }

    @Override
    public List<WeeklyExpenseActualEntity> findActualLines(String tenantId, String projectId) {
        return actualRepository.findByTenantIdAndProjectId(tenantId, projectId);
    }

    @Override
    public List<WeeklyExpenseActualEntity> findActualLinesForAudit(String tenantId, String projectId) {
        return actualRepository.findByTenantIdAndProjectIdOrderByYearMonthAscWeekNoAscSheetKeyAscCashflowLineAsc(tenantId, projectId);
    }

    @Override
    public WeeklyExpenseAuditEventEntity saveAuditEvent(WeeklyExpenseAuditEventEntity auditEvent) {
        return auditEventRepository.save(auditEvent);
    }

    @Override
    public List<WeeklyExpenseAuditEventEntity> findAuditEventsForAudit(String tenantId, String projectId) {
        return auditEventRepository.findByTenantIdAndProjectIdOrderByCreatedAtAsc(tenantId, projectId);
    }

    @Override
    public List<WeeklyExpenseAuditEventEntity> findRecentAuditEvents(String tenantId, String projectId, int limit) {
        if (limit <= 0) return List.of();
        return auditEventRepository.findTop5ByTenantIdAndProjectIdOrderByCreatedAtDesc(tenantId, projectId)
            .stream()
            .limit(limit)
            .toList();
    }

    @Override
    public WeeklyExpenseAuditExportEntity saveAuditExport(WeeklyExpenseAuditExportEntity auditExport) {
        return auditExportRepository.save(auditExport);
    }

    @Override
    public WeeklyExpenseBankImportBatchEntity saveBankImportBatch(WeeklyExpenseBankImportBatchEntity batch) {
        return bankImportBatchRepository.saveAndFlush(batch);
    }

    @Override
    public Optional<WeeklyExpenseBankImportLineEntity> findBankImportLineBySourceKey(
        String tenantId,
        String projectId,
        String sourceLineKey
    ) {
        return bankImportLineRepository.findByTenantIdAndProjectIdAndSourceLineKey(tenantId, projectId, sourceLineKey);
    }

    @Override
    public List<WeeklyExpenseBankImportLineEntity> findBankImportLines(String tenantId, String projectId, String status) {
        return bankImportLineRepository.findByTenantIdAndProjectIdAndOptionalStatus(tenantId, projectId, status);
    }

    @Override
    public List<WeeklyExpenseBankImportLineEntity> findBankImportLinesForUpdate(
        String tenantId,
        String projectId,
        Collection<String> ids
    ) {
        return bankImportLineRepository.findLockedByTenantIdAndProjectIdAndIdIn(tenantId, projectId, ids);
    }

    @Override
    public List<WeeklyExpenseBankImportLineEntity> saveBankImportLines(List<WeeklyExpenseBankImportLineEntity> lines) {
        return bankImportLineRepository.saveAll(lines);
    }

    @Override
    public Optional<WeeklyExpenseProjectionEntity> findProjectionLine(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo,
        String cashflowLine
    ) {
        return projectionRepository.findByTenantIdAndProjectIdAndYearMonthAndWeekNoAndCashflowLine(
            tenantId,
            projectId,
            yearMonth,
            weekNo,
            cashflowLine
        );
    }

    @Override
    public WeeklyExpenseProjectionEntity saveProjection(WeeklyExpenseProjectionEntity projection) {
        return projectionRepository.save(projection);
    }

    @Override
    public List<WeeklyExpenseProjectionEntity> findProjectionLines(String tenantId, String projectId) {
        return projectionRepository.findByTenantIdAndProjectId(tenantId, projectId);
    }

    @Override
    public List<WeeklyExpenseProjectionEntity> findProjectionLinesForAudit(String tenantId, String projectId) {
        return projectionRepository.findByTenantIdAndProjectIdOrderByYearMonthAscWeekNoAscCashflowLineAsc(tenantId, projectId);
    }

    @Override
    public Optional<WeeklyExpenseWeeklyStatusEntity> findWeeklyStatus(
        String tenantId,
        String projectId,
        String yearMonth,
        int weekNo
    ) {
        return weeklyStatusRepository.findByTenantIdAndProjectIdAndYearMonthAndWeekNo(tenantId, projectId, yearMonth, weekNo);
    }

    @Override
    public WeeklyExpenseWeeklyStatusEntity saveWeeklyStatus(WeeklyExpenseWeeklyStatusEntity status) {
        return weeklyStatusRepository.save(status);
    }

    @Override
    public List<WeeklyExpenseWeeklyStatusEntity> findWeeklyStatuses(String tenantId, String projectId) {
        return weeklyStatusRepository.findByTenantIdAndProjectIdOrderByYearMonthDescWeekNoAsc(tenantId, projectId);
    }
}
