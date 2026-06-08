package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "weekly_expense_cells",
    uniqueConstraints = @UniqueConstraint(name = "uk_weekly_expense_cell_position", columnNames = {"row_id", "column_index"}),
    indexes = {
        @Index(name = "idx_weekly_expense_cell_row", columnList = "row_id"),
        @Index(name = "idx_weekly_expense_cell_status", columnList = "validation_status")
    }
)
public class WeeklyExpenseCellEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "row_id", nullable = false)
    private WeeklyExpenseRowEntity row;

    @Column(name = "column_index", nullable = false)
    private int columnIndex;

    @Column(name = "raw_value", nullable = false, length = 4000)
    private String rawValue = "";

    @Column(name = "normalized_value", nullable = false, length = 4000)
    private String normalizedValue = "";

    @Enumerated(EnumType.STRING)
    @Column(name = "value_type", nullable = false, length = 20)
    private SpreadsheetValueType valueType = SpreadsheetValueType.TEXT;

    @Enumerated(EnumType.STRING)
    @Column(name = "validation_status", nullable = false, length = 30)
    private CellValidationStatus validationStatus = CellValidationStatus.UNKNOWN;

    @Column(name = "validation_message", nullable = false, length = 1000)
    private String validationMessage = "";

    @Column(name = "user_edited", nullable = false)
    private boolean userEdited;

    protected WeeklyExpenseCellEntity() {
    }

    public WeeklyExpenseCellEntity(WeeklyExpenseRowEntity row, int columnIndex) {
        this.row = row;
        this.columnIndex = columnIndex;
    }

    public void restorePersistenceState(String id) {
        this.id = id == null || id.isBlank() ? this.id : id.trim();
    }

    public String getId() {
        return id;
    }

    public WeeklyExpenseRowEntity getRow() {
        return row;
    }

    public int getColumnIndex() {
        return columnIndex;
    }

    public String getRawValue() {
        return rawValue;
    }

    public void setRawValue(String rawValue) {
        this.rawValue = rawValue == null ? "" : rawValue;
    }

    public String getNormalizedValue() {
        return normalizedValue;
    }

    public void setNormalizedValue(String normalizedValue) {
        this.normalizedValue = normalizedValue == null ? "" : normalizedValue;
    }

    public SpreadsheetValueType getValueType() {
        return valueType;
    }

    public void setValueType(SpreadsheetValueType valueType) {
        this.valueType = valueType == null ? SpreadsheetValueType.TEXT : valueType;
    }

    public CellValidationStatus getValidationStatus() {
        return validationStatus;
    }

    public void setValidationStatus(CellValidationStatus validationStatus) {
        this.validationStatus = validationStatus == null ? CellValidationStatus.UNKNOWN : validationStatus;
    }

    public String getValidationMessage() {
        return validationMessage;
    }

    public void setValidationMessage(String validationMessage) {
        this.validationMessage = validationMessage == null ? "" : validationMessage;
    }

    public boolean isUserEdited() {
        return userEdited;
    }

    public void setUserEdited(boolean userEdited) {
        this.userEdited = userEdited;
    }

    public WeeklyExpenseCellEntity copyForRow(WeeklyExpenseRowEntity targetRow, int targetColumnIndex, ClipboardDepth depth) {
        WeeklyExpenseCellEntity copy = new WeeklyExpenseCellEntity(targetRow, targetColumnIndex);
        copy.setRawValue(rawValue);
        copy.setNormalizedValue(depth == ClipboardDepth.DEEP ? normalizedValue : rawValue);
        copy.setValueType(depth == ClipboardDepth.DEEP ? valueType : SpreadsheetValueType.TEXT);
        copy.setValidationStatus(depth == ClipboardDepth.DEEP ? validationStatus : CellValidationStatus.UNKNOWN);
        copy.setValidationMessage(depth == ClipboardDepth.DEEP ? validationMessage : "");
        copy.setUserEdited(true);
        return copy;
    }
}
