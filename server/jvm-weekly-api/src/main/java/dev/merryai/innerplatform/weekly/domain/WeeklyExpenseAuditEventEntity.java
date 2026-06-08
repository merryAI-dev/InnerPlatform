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
    name = "weekly_expense_audit_events",
    indexes = {
        @Index(name = "idx_weekly_expense_audit_project", columnList = "tenant_id,project_id,created_at"),
        @Index(name = "idx_weekly_expense_audit_actor", columnList = "actor_id,created_at")
    }
)
public class WeeklyExpenseAuditEventEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "tenant_id", nullable = false, length = 120)
    private String tenantId;

    @Column(name = "project_id", nullable = false, length = 120)
    private String projectId;

    @Column(name = "sheet_key", nullable = false, length = 120)
    private String sheetKey;

    @Column(name = "command_name", nullable = false, length = 120)
    private String commandName;

    @Column(name = "actor_id", nullable = false, length = 160)
    private String actorId;

    @Column(name = "actor_role", nullable = false, length = 80)
    private String actorRole;

    @Column(name = "idempotency_key", nullable = false, length = 160)
    private String idempotencyKey;

    @Column(name = "metadata_json", nullable = false, columnDefinition = "text")
    private String metadataJson;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected WeeklyExpenseAuditEventEntity() {
    }

    public WeeklyExpenseAuditEventEntity(
        String tenantId,
        String projectId,
        String sheetKey,
        String commandName,
        String actorId,
        String actorRole,
        String idempotencyKey,
        String metadataJson
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.sheetKey = sheetKey;
        this.commandName = commandName;
        this.actorId = actorId;
        this.actorRole = actorRole;
        this.idempotencyKey = idempotencyKey;
        this.metadataJson = metadataJson;
    }

    public String getId() {
        return id;
    }

    public String getSheetKey() {
        return sheetKey;
    }

    public String getCommandName() {
        return commandName;
    }

    public String getActorId() {
        return actorId;
    }

    public String getActorRole() {
        return actorRole;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
