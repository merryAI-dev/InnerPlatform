package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(
    name = "weekly_expense_projections",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_weekly_expense_projection_line",
        columnNames = {"tenant_id", "project_id", "year_month", "week_no", "cashflow_line"}
    ),
    indexes = @Index(name = "idx_weekly_expense_projection_project", columnList = "tenant_id,project_id,year_month,week_no")
)
public class WeeklyExpenseProjectionEntity {
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

    @Column(name = "cashflow_line", nullable = false, length = 200)
    private String cashflowLine;

    @Column(name = "amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal amount = BigDecimal.ZERO;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected WeeklyExpenseProjectionEntity() {
    }

    public WeeklyExpenseProjectionEntity(String tenantId, String projectId, String yearMonth, int weekNo, String cashflowLine) {
        this.tenantId = tenantId;
        this.projectId = projectId;
        this.yearMonth = yearMonth;
        this.weekNo = weekNo;
        this.cashflowLine = cashflowLine;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount == null ? BigDecimal.ZERO : amount;
        this.updatedAt = Instant.now();
    }

    public String getYearMonth() {
        return yearMonth;
    }

    public int getWeekNo() {
        return weekNo;
    }

    public String getCashflowLine() {
        return cashflowLine;
    }

    public BigDecimal getAmount() {
        return amount;
    }
}
