package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(
    name = "weekly_expense_bank_import_batches",
    indexes = @Index(name = "idx_weekly_expense_bank_import_batch_project", columnList = "tenant_id,project_id,created_at")
)
public class WeeklyExpenseBankImportBatchEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "tenant_id", nullable = false, length = 120)
    private String tenantId;

    @Column(name = "project_id", nullable = false, length = 120)
    private String projectId;

    @Column(name = "upload_name", nullable = false, length = 240)
    private String uploadName;

    @Column(name = "column_json", nullable = false, columnDefinition = "text")
    private String columnJson;

    @Column(name = "status", nullable = false, length = 40)
    private String status = "staged";

    @Column(name = "created_by", nullable = false, length = 160)
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @OneToMany(mappedBy = "batch", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("lineIndex ASC")
    private List<WeeklyExpenseBankImportLineEntity> lines = new ArrayList<>();

    protected WeeklyExpenseBankImportBatchEntity() {
    }

    public WeeklyExpenseBankImportBatchEntity(
        String tenantId,
        String projectId,
        String uploadName,
        String columnJson,
        String createdBy
    ) {
        this.tenantId = requireText(tenantId, "tenantId");
        this.projectId = requireText(projectId, "projectId");
        this.uploadName = uploadName == null || uploadName.isBlank() ? "bank-statement-upload" : uploadName.trim();
        this.columnJson = columnJson == null ? "[]" : columnJson;
        this.createdBy = requireText(createdBy, "createdBy");
    }

    public String getId() {
        return id;
    }

    public String getTenantId() {
        return tenantId;
    }

    public String getProjectId() {
        return projectId;
    }

    public String getUploadName() {
        return uploadName;
    }

    public String getColumnJson() {
        return columnJson;
    }

    public String getStatus() {
        return status;
    }

    public String getCreatedBy() {
        return createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public List<WeeklyExpenseBankImportLineEntity> getLines() {
        return lines;
    }

    public void addLine(WeeklyExpenseBankImportLineEntity line) {
        lines.add(line);
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value.trim();
    }
}
