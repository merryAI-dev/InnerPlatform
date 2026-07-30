package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public record CashflowPendingApprovalAffectedMonth(
    @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
    @Min(1) @Max(1) int warningCountIncrement,
    @Min(1) @Max(MAX_CHANGES_PER_MONTH) int differenceCount,
    @Valid @NotNull @Size(min = 1, max = MAX_DIFFERENCES_PER_MONTH) List<ApprovalDifference> approvalDifferences
) {
    public static final int MAX_DIFFERENCES_PER_MONTH = 12;
    public static final int MAX_CHANGES_PER_MONTH = MAX_DIFFERENCES_PER_MONTH * 160;
    private static final BigDecimal MAX_SAFE_AMOUNT = new BigDecimal("9007199254740991");
    private static final java.util.regex.Pattern YEAR_MONTH = java.util.regex.Pattern.compile("20\\d{2}-(0[1-9]|1[0-2])");
    private static final java.util.regex.Pattern HASH = java.util.regex.Pattern.compile("sha256:[a-f0-9]{64}");

    public CashflowPendingApprovalAffectedMonth {
        approvalDifferences = approvalDifferences == null ? List.of() : List.copyOf(approvalDifferences);
    }

    public static List<CashflowPendingApprovalAffectedMonth> requireValid(
        List<CashflowPendingApprovalAffectedMonth> instructions,
        Collection<String> appliedMonths
    ) {
        if (instructions == null || instructions.isEmpty()) return List.of();
        if (instructions.size() > CashflowSheetBatchApplyRequest.MAX_MONTH_COUNT) {
            throw new IllegalArgumentException("Pending approval warnings may cover at most 12 months.");
        }
        Set<String> scope = Set.copyOf(appliedMonths);
        Set<String> months = new HashSet<>();
        List<CashflowPendingApprovalAffectedMonth> normalized = new ArrayList<>();
        for (CashflowPendingApprovalAffectedMonth instruction : instructions) {
            if (instruction == null || instruction.yearMonth() == null
                || !YEAR_MONTH.matcher(instruction.yearMonth()).matches()
                || !scope.contains(instruction.yearMonth())) {
                throw new IllegalArgumentException("Pending approval warning month is outside the applied scope.");
            }
            if (instruction.warningCountIncrement() != 1 || !months.add(instruction.yearMonth())) {
                throw new IllegalArgumentException("Pending approval warning months must be unique with increment 1.");
            }
            if (instruction.approvalDifferences().isEmpty()
                || instruction.approvalDifferences().size() > MAX_DIFFERENCES_PER_MONTH) {
                throw new IllegalArgumentException("Pending approval warning evidence count is invalid.");
            }
            int count = 0;
            Set<String> identities = new HashSet<>();
            for (ApprovalDifference difference : instruction.approvalDifferences()) {
                if (difference == null || !instruction.yearMonth().equals(difference.yearMonth())) {
                    throw new IllegalArgumentException("Pending approval difference month does not match its warning.");
                }
                if (difference.requestId() == null || difference.requestId().isBlank()
                    || difference.requestId().length() > 200 || difference.requestRevision() < 1
                    || !("PENDING".equals(difference.requestStatus())
                        || "APPROVING".equals(difference.requestStatus())
                        || "UNCERTAIN".equals(difference.requestStatus()))
                    || difference.requestManifestHash() == null
                    || !HASH.matcher(difference.requestManifestHash()).matches()) {
                    throw new IllegalArgumentException("Pending approval request evidence is invalid.");
                }
                if (difference.truncatedChangeCount() != 0
                    || difference.differenceCount() != difference.changes().size()
                    || difference.changes().isEmpty()
                    || difference.changes().size() > 160) {
                    throw new IllegalArgumentException("Pending approval difference details are incomplete.");
                }
                Set<Integer> weeks = new HashSet<>();
                for (Change change : difference.changes()) {
                    requireValidChange(change);
                    weeks.add(change.weekNo());
                    String identity = difference.requestId() + "|" + change.mode() + "|"
                        + change.weekNo() + "|" + change.lineId();
                    if (!identities.add(identity)) {
                        throw new IllegalArgumentException("Pending approval difference contains duplicate cells.");
                    }
                }
                if (difference.weeks().size() != new HashSet<>(difference.weeks()).size()
                    || !weeks.equals(new HashSet<>(difference.weeks()))) {
                    throw new IllegalArgumentException("Pending approval difference weeks do not match its cells.");
                }
                count = Math.addExact(count, difference.differenceCount());
            }
            if (count != instruction.differenceCount() || count > MAX_CHANGES_PER_MONTH) {
                throw new IllegalArgumentException("Pending approval warning differenceCount does not match its cells.");
            }
            normalized.add(instruction);
        }
        normalized.sort(Comparator.comparing(CashflowPendingApprovalAffectedMonth::yearMonth));
        return List.copyOf(normalized);
    }

    private static void requireValidChange(Change change) {
        if (change == null || change.weekNo() < 1 || change.weekNo() > 5
            || !("projection".equals(change.mode()) || "actual".equals(change.mode()))
            || !CashflowLineCatalog.ALL_LINES.contains(change.lineId())) {
            throw new IllegalArgumentException("Pending approval difference cell identity is invalid.");
        }
        requireState(change.beforeHadValue(), change.beforeState(), change.beforeAmount());
        requireState(change.afterHadValue(), change.afterState(), change.afterAmount());
        if (change.beforeHadValue() == change.afterHadValue()
            && change.beforeState().equals(change.afterState())
            && java.util.Objects.equals(change.beforeAmount(), change.afterAmount())) {
            throw new IllegalArgumentException("Pending approval difference must change the cell.");
        }
    }

    private static void requireState(boolean hadValue, String rawState, BigDecimal amount) {
        String state = rawState == null ? "" : rawState.trim().toUpperCase(Locale.ROOT);
        if (!state.equals(rawState)) {
            throw new IllegalArgumentException("Pending approval cell state must use its canonical value.");
        }
        boolean valid = switch (state) {
            case "EMPTY" -> !hadValue && amount == null;
            case "ZERO" -> hadValue && amount != null && amount.compareTo(BigDecimal.ZERO) == 0;
            case "VALUE" -> hadValue && amount != null && amount.compareTo(BigDecimal.ZERO) != 0;
            default -> false;
        };
        if (!valid) throw new IllegalArgumentException("Pending approval cell state and amount do not match.");
        if (amount != null) {
            try {
                amount.longValueExact();
            } catch (ArithmeticException error) {
                throw new IllegalArgumentException("Pending approval amounts must be whole won values.");
            }
            if (amount.abs().compareTo(MAX_SAFE_AMOUNT) > 0) {
                throw new IllegalArgumentException("Pending approval amount exceeds the safe integer range.");
            }
        }
    }

    public record ApprovalDifference(
        @NotBlank @Size(max = 200) String requestId,
        @Min(1) long requestRevision,
        @NotBlank @Pattern(regexp = "PENDING|APPROVING|UNCERTAIN") String requestStatus,
        @NotBlank @Pattern(regexp = "sha256:[a-f0-9]{64}") String requestManifestHash,
        @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
        @Min(1) @Max(160) int differenceCount,
        @NotNull @Size(min = 1, max = 5) List<@Min(1) @Max(5) Integer> weeks,
        @Valid @NotNull @Size(min = 1, max = 160) List<Change> changes,
        @Min(0) @Max(0) int truncatedChangeCount
    ) {
        public ApprovalDifference {
            weeks = weeks == null ? List.of() : List.copyOf(weeks);
            changes = changes == null ? List.of() : List.copyOf(changes);
        }
    }

    public record Change(
        @NotBlank @Pattern(regexp = "projection|actual") String mode,
        @Min(1) @Max(5) int weekNo,
        @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_CASHFLOW_LINE_LENGTH) String lineId,
        boolean beforeHadValue,
        @NotBlank @Pattern(regexp = "VALUE|ZERO|EMPTY") String beforeState,
        BigDecimal beforeAmount,
        boolean afterHadValue,
        @NotBlank @Pattern(regexp = "VALUE|ZERO|EMPTY") String afterState,
        BigDecimal afterAmount
    ) {
    }
}
