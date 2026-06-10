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
    name = "weekly_expense_weekly_statuses",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_weekly_expense_weekly_status",
        columnNames = {"tenant_id", "project_id", "year_month", "week_no"}
    ),
    indexes = @Index(name = "idx_weekly_expense_weekly_status_project", columnList = "tenant_id,project_id,year_month,week_no")
)
public class WeeklyExpenseWeeklyStatusEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "tenant_id", nullable = false, length = 120)
    private String tenantId;

    @Column(name = "project_id", nullable = false, length = 120)
    private String projectId;

    @Column(name = "year_month", nullable = false, length = 7)
    private String yearMonth;

    @Column(name = "week_no", nullable = false)
    private int weekNo;

    @Column(name = "state", nullable = false, length = 40)
    private String state = "draft";

    @Column(name = "submitted_by", length = 160)
    private String submittedBy;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "closed_by", length = 160)
    private String closedBy;

    @Column(name = "closed_at")
    private Instant closedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected WeeklyExpenseWeeklyStatusEntity() {
    }

    public WeeklyExpenseWeeklyStatusEntity(String tenantId, String projectId, String yearMonth, int weekNo) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.yearMonth = yearMonth;
        this.weekNo = weekNo;
    }

    public void submit(String actorId) {
        if ("closed".equals(state)) {
            throw new IllegalStateException("Closed week cannot be submitted.");
        }
        this.state = "submitted";
        this.submittedBy = actorId;
        this.submittedAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    public void close(String actorId) {
        if (!"submitted".equals(state)) {
            throw new IllegalStateException("Only submitted weeks can be closed.");
        }
        this.state = "closed";
        this.closedBy = actorId;
        this.closedAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    public String getYearMonth() {
        return yearMonth;
    }

    public String getTenantId() {
        return tenantId;
    }

    public String getProjectId() {
        return projectId;
    }

    public int getWeekNo() {
        return weekNo;
    }

    public String getState() {
        return state;
    }

    public String getSubmittedBy() {
        return submittedBy;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public String getClosedBy() {
        return closedBy;
    }

    public Instant getClosedAt() {
        return closedAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void restorePersistenceState(
        String id,
        String state,
        String submittedBy,
        Instant submittedAt,
        String closedBy,
        Instant closedAt,
        Instant updatedAt
    ) {
        this.id = id == null || id.isBlank() ? this.id : id.trim();
        this.state = state == null || state.isBlank() ? this.state : state.trim();
        this.submittedBy = submittedBy == null || submittedBy.isBlank() ? null : submittedBy.trim();
        this.submittedAt = submittedAt;
        this.closedBy = closedBy == null || closedBy.isBlank() ? null : closedBy.trim();
        this.closedAt = closedAt;
        if (updatedAt != null) this.updatedAt = updatedAt;
    }
}
