package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Entity
@Table(
    name = "weekly_expense_sheets",
    uniqueConstraints = @UniqueConstraint(name = "uk_weekly_expense_sheet_natural_id", columnNames = {"tenant_id", "project_id", "sheet_key"}),
    indexes = {
        @Index(name = "idx_weekly_expense_sheet_project", columnList = "tenant_id,project_id")
    }
)
public class WeeklyExpenseSheetEntity {
    private static final int MAX_ROW_INDEX = 1999;

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "tenant_id", nullable = false, length = 120)
    private String tenantId;

    @Column(name = "project_id", nullable = false, length = 120)
    private String projectId;

    @Column(name = "sheet_key", nullable = false, length = 120)
    private String sheetKey;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Version
    @Column(name = "sheet_version", nullable = false)
    private long sheetVersion;

    @OneToMany(mappedBy = "sheet", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("rowIndex ASC")
    private List<WeeklyExpenseRowEntity> rows = new ArrayList<>();

    protected WeeklyExpenseSheetEntity() {
    }

    public WeeklyExpenseSheetEntity(String tenantId, String projectId, String sheetKey, String name) {
        this.tenantId = requireText(tenantId, "tenantId");
        this.projectId = requireText(projectId, "projectId");
        this.sheetKey = requireText(sheetKey, "sheetKey");
        this.name = name == null || name.isBlank() ? sheetKey : name.trim();
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

    public String getSheetKey() {
        return sheetKey;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name == null || name.isBlank() ? sheetKey : name.trim();
    }

    public long getSheetVersion() {
        return sheetVersion;
    }

    public List<WeeklyExpenseRowEntity> getRows() {
        rows.sort(Comparator.comparingInt(WeeklyExpenseRowEntity::getRowIndex));
        return rows;
    }

    public Optional<WeeklyExpenseRowEntity> findRow(int rowIndex) {
        return rows.stream().filter(row -> row.getRowIndex() == rowIndex).findFirst();
    }

    public WeeklyExpenseRowEntity rowAt(int rowIndex) {
        if (rowIndex < 0) throw new IllegalArgumentException("rowIndex must be non-negative");
        if (rowIndex > MAX_ROW_INDEX) throw new IllegalArgumentException("rowIndex exceeds weekly expense sheet row limit");
        return findRow(rowIndex).orElseGet(() -> {
            WeeklyExpenseRowEntity row = new WeeklyExpenseRowEntity(this, rowIndex);
            rows.add(row);
            return row;
        });
    }

    public List<Integer> moveRowsToTemporaryIndexesFrom(int startRow, int temporaryOffset) {
        if (startRow < 0) throw new IllegalArgumentException("startRow must be non-negative");
        if (temporaryOffset <= 0) throw new IllegalArgumentException("temporaryOffset must be positive");

        List<Integer> moved = new ArrayList<>();
        for (WeeklyExpenseRowEntity row : getRows()) {
            if (row.getRowIndex() >= startRow) {
                moved.add(row.getRowIndex());
                row.setRowIndex(row.getRowIndex() + temporaryOffset);
            }
        }
        return moved;
    }

    public List<Integer> finishInsertRowsFromTemporaryIndexes(int startRow, int rowCount, int temporaryOffset) {
        if (startRow < 0) throw new IllegalArgumentException("startRow must be non-negative");
        if (rowCount <= 0) throw new IllegalArgumentException("rowCount must be positive");
        if (temporaryOffset <= 0) throw new IllegalArgumentException("temporaryOffset must be positive");
        if (startRow + rowCount - 1 > MAX_ROW_INDEX) {
            throw new IllegalArgumentException("inserted row range exceeds weekly expense sheet row limit");
        }

        for (WeeklyExpenseRowEntity row : getRows()) {
            if (row.getRowIndex() >= startRow + temporaryOffset) {
                int finalRowIndex = row.getRowIndex() - temporaryOffset + rowCount;
                if (finalRowIndex > MAX_ROW_INDEX) {
                    throw new IllegalArgumentException("row insert would move existing rows beyond weekly expense sheet row limit");
                }
                row.setRowIndex(finalRowIndex);
            }
        }
        List<Integer> inserted = new ArrayList<>();
        for (int offset = 0; offset < rowCount; offset += 1) {
            int rowIndex = startRow + offset;
            rows.add(new WeeklyExpenseRowEntity(this, rowIndex));
            inserted.add(rowIndex);
        }
        return inserted;
    }

    public List<Integer> finishDeleteRowsFromTemporaryIndexes(int startRow, int rowCount, int temporaryOffset) {
        if (startRow < 0) throw new IllegalArgumentException("startRow must be non-negative");
        if (rowCount <= 0) throw new IllegalArgumentException("rowCount must be positive");
        if (temporaryOffset <= 0) throw new IllegalArgumentException("temporaryOffset must be positive");

        int endRow = startRow + rowCount - 1;
        List<Integer> deleted = new ArrayList<>();
        rows.removeIf(row -> {
            int originalRowIndex = row.getRowIndex() - temporaryOffset;
            boolean shouldDelete = originalRowIndex >= startRow && originalRowIndex <= endRow;
            if (shouldDelete) deleted.add(originalRowIndex);
            return shouldDelete;
        });

        for (WeeklyExpenseRowEntity row : getRows()) {
            if (row.getRowIndex() >= temporaryOffset) {
                int originalRowIndex = row.getRowIndex() - temporaryOffset;
                if (originalRowIndex > endRow) {
                    row.setRowIndex(originalRowIndex - rowCount);
                }
            }
        }
        deleted.sort(Integer::compareTo);
        return deleted;
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value.trim();
    }
}
