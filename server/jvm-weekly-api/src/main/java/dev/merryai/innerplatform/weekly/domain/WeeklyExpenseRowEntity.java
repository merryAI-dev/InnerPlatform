package dev.merryai.innerplatform.weekly.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Entity
@Table(
    name = "weekly_expense_rows",
    uniqueConstraints = @UniqueConstraint(name = "uk_weekly_expense_row_position", columnNames = {"sheet_id", "row_index"}),
    indexes = {
        @Index(name = "idx_weekly_expense_row_sheet", columnList = "sheet_id"),
        @Index(name = "idx_weekly_expense_row_source_tx", columnList = "source_tx_id")
    }
)
public class WeeklyExpenseRowEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sheet_id", nullable = false)
    private WeeklyExpenseSheetEntity sheet;

    @Column(name = "row_index", nullable = false)
    private int rowIndex;

    @Version
    @Column(name = "row_version", nullable = false)
    private long rowVersion;

    @Column(name = "source_tx_id", length = 120)
    private String sourceTxId;

    @Column(name = "entry_kind", nullable = false, length = 30)
    private String entryKind = "";

    @Column(name = "validation_error_count", nullable = false)
    private int validationErrorCount;

    @Column(name = "review_required_count", nullable = false)
    private int reviewRequiredCount;

    @Column(name = "deposit_amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal depositAmount = BigDecimal.ZERO;

    @Column(name = "refund_amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal refundAmount = BigDecimal.ZERO;

    @Column(name = "expense_amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal expenseAmount = BigDecimal.ZERO;

    @Column(name = "vat_in_amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal vatInAmount = BigDecimal.ZERO;

    @Column(name = "bank_amount", nullable = false, precision = 19, scale = 2)
    private BigDecimal bankAmount = BigDecimal.ZERO;

    @OneToMany(mappedBy = "row", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("columnIndex ASC")
    private List<WeeklyExpenseCellEntity> cells = new ArrayList<>();

    protected WeeklyExpenseRowEntity() {
    }

    public WeeklyExpenseRowEntity(WeeklyExpenseSheetEntity sheet, int rowIndex) {
        this.sheet = sheet;
        this.rowIndex = rowIndex;
    }

    public String getId() {
        return id;
    }

    public int getRowIndex() {
        return rowIndex;
    }

    void setRowIndex(int rowIndex) {
        if (rowIndex < 0) throw new IllegalArgumentException("rowIndex must be non-negative");
        this.rowIndex = rowIndex;
    }

    public long getRowVersion() {
        return rowVersion;
    }

    public String getSourceTxId() {
        return sourceTxId;
    }

    public void setSourceTxId(String sourceTxId) {
        this.sourceTxId = sourceTxId == null || sourceTxId.isBlank() ? null : sourceTxId.trim();
    }

    public String getEntryKind() {
        return entryKind;
    }

    public void setEntryKind(String entryKind) {
        this.entryKind = entryKind == null ? "" : entryKind.trim();
    }

    public int getValidationErrorCount() {
        return validationErrorCount;
    }

    public void setValidationErrorCount(int validationErrorCount) {
        this.validationErrorCount = Math.max(0, validationErrorCount);
    }

    public int getReviewRequiredCount() {
        return reviewRequiredCount;
    }

    public void setReviewRequiredCount(int reviewRequiredCount) {
        this.reviewRequiredCount = Math.max(0, reviewRequiredCount);
    }

    public BigDecimal getDepositAmount() {
        return depositAmount;
    }

    public void setDepositAmount(BigDecimal depositAmount) {
        this.depositAmount = depositAmount == null ? BigDecimal.ZERO : depositAmount;
    }

    public BigDecimal getRefundAmount() {
        return refundAmount;
    }

    public void setRefundAmount(BigDecimal refundAmount) {
        this.refundAmount = refundAmount == null ? BigDecimal.ZERO : refundAmount;
    }

    public BigDecimal getExpenseAmount() {
        return expenseAmount;
    }

    public void setExpenseAmount(BigDecimal expenseAmount) {
        this.expenseAmount = expenseAmount == null ? BigDecimal.ZERO : expenseAmount;
    }

    public BigDecimal getVatInAmount() {
        return vatInAmount;
    }

    public void setVatInAmount(BigDecimal vatInAmount) {
        this.vatInAmount = vatInAmount == null ? BigDecimal.ZERO : vatInAmount;
    }

    public BigDecimal getBankAmount() {
        return bankAmount;
    }

    public void setBankAmount(BigDecimal bankAmount) {
        this.bankAmount = bankAmount == null ? BigDecimal.ZERO : bankAmount;
    }

    public List<WeeklyExpenseCellEntity> getCells() {
        cells.sort(Comparator.comparingInt(WeeklyExpenseCellEntity::getColumnIndex));
        return cells;
    }

    public Optional<WeeklyExpenseCellEntity> findCell(int columnIndex) {
        return cells.stream().filter(cell -> cell.getColumnIndex() == columnIndex).findFirst();
    }

    public WeeklyExpenseCellEntity cellAt(int columnIndex) {
        if (WeeklyExpenseColumn.fromIndex(columnIndex).isEmpty()) {
            throw new IllegalArgumentException("columnIndex is outside the weekly expense sheet schema");
        }
        return findCell(columnIndex).orElseGet(() -> {
            WeeklyExpenseCellEntity cell = new WeeklyExpenseCellEntity(this, columnIndex);
            cells.add(cell);
            return cell;
        });
    }
}
