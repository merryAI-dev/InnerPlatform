package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(
    name = "weekly_expense_audit_exports",
    indexes = {
        @Index(name = "idx_weekly_expense_export_project", columnList = "tenant_id,project_id,created_at"),
        @Index(name = "idx_weekly_expense_export_hash", columnList = "artifact_sha256")
    }
)
public class WeeklyExpenseAuditExportEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "tenant_id", nullable = false, length = 120)
    private String tenantId;

    @Column(name = "project_id", nullable = false, length = 120)
    private String projectId;

    @Column(name = "artifact_type", nullable = false, length = 40)
    private String artifactType;

    @Column(name = "artifact_file_name", nullable = false, length = 240)
    private String artifactFileName;

    @Column(name = "artifact_sha256", nullable = false, length = 64)
    private String artifactSha256;

    @Column(name = "artifact_content", nullable = false, columnDefinition = "text")
    private String artifactContent;

    @Column(name = "projection_line_count", nullable = false)
    private int projectionLineCount;

    @Column(name = "actual_line_count", nullable = false)
    private int actualLineCount;

    @Column(name = "audit_event_count", nullable = false)
    private int auditEventCount;

    @Column(name = "created_by", nullable = false, length = 160)
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected WeeklyExpenseAuditExportEntity() {
    }

    public WeeklyExpenseAuditExportEntity(
        String tenantId,
        String projectId,
        String artifactType,
        String artifactFileName,
        String artifactSha256,
        String artifactContent,
        int projectionLineCount,
        int actualLineCount,
        int auditEventCount,
        String createdBy
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.artifactType = artifactType;
        this.artifactFileName = artifactFileName;
        this.artifactSha256 = artifactSha256;
        this.artifactContent = artifactContent;
        this.projectionLineCount = projectionLineCount;
        this.actualLineCount = actualLineCount;
        this.auditEventCount = auditEventCount;
        this.createdBy = createdBy;
    }

    public String getId() {
        return id;
    }

    public String getArtifactType() {
        return artifactType;
    }

    public String getArtifactFileName() {
        return artifactFileName;
    }

    public String getArtifactSha256() {
        return artifactSha256;
    }

    public String getArtifactContent() {
        return artifactContent;
    }

    public int getProjectionLineCount() {
        return projectionLineCount;
    }

    public int getActualLineCount() {
        return actualLineCount;
    }

    public int getAuditEventCount() {
        return auditEventCount;
    }
}
