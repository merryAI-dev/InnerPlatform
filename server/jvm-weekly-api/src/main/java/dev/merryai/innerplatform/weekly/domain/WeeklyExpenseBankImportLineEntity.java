package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(
    name = "weekly_expense_bank_import_lines",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_weekly_expense_bank_import_line_key",
        columnNames = {"tenant_id", "project_id", "source_line_key"}
    ),
    indexes = {
        @Index(name = "idx_weekly_expense_bank_import_line_batch", columnList = "batch_id,line_index"),
        @Index(name = "idx_weekly_expense_bank_import_line_status", columnList = "tenant_id,project_id,status")
    }
)
public class WeeklyExpenseBankImportLineEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "batch_id", nullable = false)
    private WeeklyExpenseBankImportBatchEntity batch;

    @Column(name = "tenant_id", nullable = false, length = 120)
    private String tenantId;

    @Column(name = "project_id", nullable = false, length = 120)
    private String projectId;

    @Column(name = "line_index", nullable = false)
    private int lineIndex;

    @Column(name = "source_line_key", nullable = false, length = 160)
    private String sourceLineKey;

    @Column(name = "transaction_date", nullable = false, length = 40)
    private String transactionDate = "";

    @Column(name = "counterparty", nullable = false, length = 400)
    private String counterparty = "";

    @Column(name = "memo", nullable = false, length = 1000)
    private String memo = "";

    @Column(name = "signed_amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal signedAmount = BigDecimal.ZERO;

    @Column(name = "balance_after", nullable = false, precision = 19, scale = 2)
    private BigDecimal balanceAfter = BigDecimal.ZERO;

    @Column(name = "raw_cells_json", nullable = false, columnDefinition = "text")
    private String rawCellsJson = "[]";

    @Column(name = "status", nullable = false, length = 40)
    private String status = "staged";

    @Column(name = "applied_sheet_key", length = 120)
    private String appliedSheetKey;

    @Column(name = "applied_row_id", length = 36)
    private String appliedRowId;

    @Column(name = "applied_at")
    private Instant appliedAt;

    @Column(name = "applied_by", length = 160)
    private String appliedBy;

    protected WeeklyExpenseBankImportLineEntity() {
    }

    public WeeklyExpenseBankImportLineEntity(
        WeeklyExpenseBankImportBatchEntity batch,
        int lineIndex,
        String sourceLineKey,
        String transactionDate,
        String counterparty,
        String memo,
        BigDecimal signedAmount,
        BigDecimal balanceAfter,
        String rawCellsJson
    ) {
        this.batch = batch;
        this.tenantId = batch.getTenantId();
        this.projectId = batch.getProjectId();
        this.lineIndex = Math.max(0, lineIndex);
        this.sourceLineKey = requireText(sourceLineKey, "sourceLineKey");
        this.transactionDate = safeText(transactionDate);
        this.counterparty = safeText(counterparty);
        this.memo = safeText(memo);
        this.signedAmount = signedAmount == null ? BigDecimal.ZERO : signedAmount;
        this.balanceAfter = balanceAfter == null ? BigDecimal.ZERO : balanceAfter;
        this.rawCellsJson = rawCellsJson == null ? "[]" : rawCellsJson;
    }

    public String getId() {
        return id;
    }

    public int getLineIndex() {
        return lineIndex;
    }

    public WeeklyExpenseBankImportBatchEntity getBatch() {
        return batch;
    }

    public String getSourceLineKey() {
        return sourceLineKey;
    }

    public String getTransactionDate() {
        return transactionDate;
    }

    public String getCounterparty() {
        return counterparty;
    }

    public String getMemo() {
        return memo;
    }

    public BigDecimal getSignedAmount() {
        return signedAmount;
    }

    public BigDecimal getBalanceAfter() {
        return balanceAfter;
    }

    public String getRawCellsJson() {
        return rawCellsJson;
    }

    public String getStatus() {
        return status;
    }

    public String getAppliedSheetKey() {
        return appliedSheetKey;
    }

    public String getAppliedRowId() {
        return appliedRowId;
    }

    public Instant getAppliedAt() {
        return appliedAt;
    }

    public String getAppliedBy() {
        return appliedBy;
    }

    public boolean isApplied() {
        return "applied".equals(status);
    }

    public void markApplied(String sheetKey, String rowId, String actorId) {
        if (isApplied()) {
            throw new IllegalStateException("Bank import line is already applied.");
        }
        this.status = "applied";
        this.appliedSheetKey = sheetKey;
        this.appliedRowId = rowId;
        this.appliedBy = actorId;
        this.appliedAt = Instant.now();
    }

    public void restorePersistenceState(
        String id,
        String status,
        String appliedSheetKey,
        String appliedRowId,
        Instant appliedAt,
        String appliedBy
    ) {
        this.id = id == null || id.isBlank() ? this.id : id.trim();
        this.status = status == null || status.isBlank() ? this.status : status.trim();
        this.appliedSheetKey = appliedSheetKey == null || appliedSheetKey.isBlank() ? null : appliedSheetKey.trim();
        this.appliedRowId = appliedRowId == null || appliedRowId.isBlank() ? null : appliedRowId.trim();
        this.appliedAt = appliedAt;
        this.appliedBy = appliedBy == null || appliedBy.isBlank() ? null : appliedBy.trim();
    }

    private static String safeText(String value) {
        return value == null ? "" : value.trim();
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value.trim();
    }
}
