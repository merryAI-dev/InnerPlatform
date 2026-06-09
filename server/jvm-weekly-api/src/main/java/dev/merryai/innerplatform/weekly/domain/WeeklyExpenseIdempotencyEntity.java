package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;

@Entity
@Table(
    name = "weekly_expense_idempotency_keys",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_weekly_expense_idempotency",
        columnNames = {"tenant_id", "project_id", "command_name", "idempotency_key"}
    ),
    indexes = @Index(name = "idx_weekly_expense_idempotency_project", columnList = "tenant_id,project_id,command_name")
)
public class WeeklyExpenseIdempotencyEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "tenant_id", nullable = false, length = 120)
    private String tenantId;

    @Column(name = "project_id", nullable = false, length = 120)
    private String projectId;

    @Column(name = "idempotency_key", nullable = false, length = 160)
    private String idempotencyKey;

    @Column(name = "command_name", nullable = false, length = 120)
    private String commandName;

    @Column(name = "request_hash", nullable = false, length = 128)
    private String requestHash;

    @Column(name = "response_json", nullable = false, columnDefinition = "text")
    private String responseJson;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected WeeklyExpenseIdempotencyEntity() {
    }

    public WeeklyExpenseIdempotencyEntity(
        String tenantId,
        String projectId,
        String idempotencyKey,
        String commandName,
        String requestHash,
        String responseJson
    ) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.idempotencyKey = idempotencyKey;
        this.commandName = commandName;
        this.requestHash = requestHash;
        this.responseJson = responseJson;
    }

    public String getRequestHash() {
        return requestHash;
    }

    public String getResponseJson() {
        return responseJson;
    }

    public String getProjectId() {
        return projectId;
    }

    public String getTenantId() {
        return tenantId;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public String getCommandName() {
        return commandName;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void restorePersistenceState(String id, Instant createdAt) {
        this.id = id == null || id.isBlank() ? this.id : id.trim();
        if (createdAt != null) this.createdAt = createdAt;
    }
}
