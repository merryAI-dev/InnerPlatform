package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.annotation.JsonIgnore;
import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public record CloseCashflowMonthRequest(
    @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH) String idempotencyKey,
    @Pattern(regexp = "|sha256:[a-f0-9]{64}") String sourceRevision,
    @Pattern(regexp = "|sha256:[a-f0-9]{64}") String targetRevision,
    @NotBlank
    @Size(min = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH, max = WeeklyExpenseRequestLimits.MAX_YEAR_MONTH_LENGTH)
    @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])")
    String yearMonth,
    @PositiveOrZero long expectedRevision,
    @PositiveOrZero long expectedDraftRevision,
    boolean humanReviewed,
    @Valid @NotNull @Size(max = CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT)
    List<DepositScheduleRow> depositScheduleRows,
    @Valid @NotNull @Size(max = CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT)
    List<CashflowSheetLabApplyRequest.Cell> cells,
    @Valid @NotNull @Size(max = CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT)
    List<Confirmation> confirmations,
    @Valid @NotNull @Size(max = 4) List<ManagementCheck> managementChecks,
    @Valid @NotNull @Size(max = 4) List<ManagementConfirmation> managementConfirmations,
    @Valid CashflowOpeningBalancesResponse openingBalances,
    @Valid DeadlineSummary deadlineSummary,
    @Size(max = 160) String requestId,
    @PositiveOrZero long requestRevision,
    @Pattern(regexp = "|sha256:[a-f0-9]{64}") String manifestHash
) {
    private static final List<String> MANAGEMENT_CHECK_IDS = List.of(
        "labor-transfer",
        "profit-vat-after-deposit",
        "negative-projection-balance",
        "future-prepay-over-million"
    );

    public record Confirmation(
        @NotBlank @Pattern(regexp = "projection|actual") String mode,
        @Min(1) @Max(CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) int weekNo,
        @NotBlank @Size(max = WeeklyExpenseRequestLimits.MAX_CASHFLOW_LINE_LENGTH) String cashflowLine,
        @NotBlank @Pattern(regexp = "CONFIRMED|NOT_APPLICABLE") String decision
    ) {
    }

    public record DepositScheduleRow(
        @Min(1) @Max(CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) int weekNo,
        @NotNull @Pattern(regexp = "|20\\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])") String taxInvoiceIssuedDate,
        @NotNull @Pattern(regexp = "|20\\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])") String expectedDepositDate,
        @PositiveOrZero BigDecimal expectedDepositAmount,
        @NotNull @Pattern(regexp = "|20\\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])") String actualDepositDate,
        @PositiveOrZero BigDecimal actualDepositAmount,
        @NotBlank @Pattern(regexp = "SHEET|BANK_TRANSACTION|DIRECT_ENTRY|NOT_APPLICABLE") String actualSource,
        @NotBlank @Pattern(regexp = "CONFIRMED|NOT_APPLICABLE") String decision
    ) {
        public DepositScheduleRow {
            taxInvoiceIssuedDate = taxInvoiceIssuedDate == null ? "" : taxInvoiceIssuedDate.trim();
            expectedDepositDate = expectedDepositDate == null ? "" : expectedDepositDate.trim();
            actualDepositDate = actualDepositDate == null ? "" : actualDepositDate.trim();
            actualSource = actualSource == null ? "" : actualSource.trim();
            decision = decision == null ? "" : decision.trim();
        }
    }

    public record ManagementCheck(
        @NotBlank @Pattern(regexp = "labor-transfer|profit-vat-after-deposit|negative-projection-balance|future-prepay-over-million") String id,
        @NotBlank @Pattern(regexp = "OK|WARNING|REVIEW_REQUIRED") String status,
        @NotBlank @Size(max = 200) String title,
        @NotBlank @Size(max = 2000) String detail,
        @Size(max = 500) List<@NotBlank @Size(max = 2000) String> findings
    ) {
        public ManagementCheck {
            findings = findings == null ? List.of() : List.copyOf(findings);
        }

        public ManagementCheck(String id, String status, String title, String detail) {
            this(id, status, title, detail, List.of());
        }
    }

    public record ManagementConfirmation(
        @NotBlank @Pattern(regexp = "labor-transfer|profit-vat-after-deposit|negative-projection-balance|future-prepay-over-million") String checkId,
        @NotBlank @Pattern(regexp = "CONFIRMED|NOT_APPLICABLE") String decision
    ) {
    }

    public record DeadlineSummary(
        @Size(max = 64) String trackingStartedAt,
        @PositiveOrZero long missedCount,
        @PositiveOrZero long completedCount,
        @Valid CurrentDeadline current
    ) {
        public DeadlineSummary {
            trackingStartedAt = trackingStartedAt == null ? "" : trackingStartedAt.trim();
        }
    }

    public record CurrentDeadline(
        @NotBlank @Pattern(regexp = "20\\d{2}-(0[1-9]|1[0-2])") String yearMonth,
        @Min(1) @Max(CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) int weekNo,
        @NotBlank @Size(max = 64) String deadline,
        @Size(max = 64) String completedAt,
        @Size(max = 200) String completedBy,
        @NotBlank @Pattern(regexp = "COMPLETED|COMPLETED_LATE|MISSED|PENDING") String status
    ) {
        public CurrentDeadline {
            completedAt = completedAt == null ? "" : completedAt.trim();
            completedBy = completedBy == null ? "" : completedBy.trim();
        }
    }

    public CloseCashflowMonthRequest {
        sourceRevision = sourceRevision == null ? "" : sourceRevision.trim();
        targetRevision = targetRevision == null ? "" : targetRevision.trim();
        requestId = requestId == null ? "" : requestId.trim();
        manifestHash = manifestHash == null ? "" : manifestHash.trim();
        depositScheduleRows = depositScheduleRows == null ? List.of() : List.copyOf(depositScheduleRows);
        cells = cells == null ? List.of() : List.copyOf(cells);
        confirmations = confirmations == null ? List.of() : List.copyOf(confirmations);
        managementChecks = managementChecks == null ? List.of() : List.copyOf(managementChecks);
        managementConfirmations = managementConfirmations == null ? List.of() : List.copyOf(managementConfirmations);
        deadlineSummary = deadlineSummary == null ? new DeadlineSummary("", 0, 0, null) : deadlineSummary;
    }

    public CloseCashflowMonthRequest(
        String idempotencyKey,
        String sourceRevision,
        String targetRevision,
        String yearMonth,
        long expectedRevision,
        long expectedDraftRevision,
        boolean humanReviewed,
        List<DepositScheduleRow> depositScheduleRows,
        List<CashflowSheetLabApplyRequest.Cell> cells,
        List<Confirmation> confirmations,
        List<ManagementCheck> managementChecks,
        List<ManagementConfirmation> managementConfirmations,
        CashflowOpeningBalancesResponse openingBalances,
        DeadlineSummary deadlineSummary
    ) {
        this(
            idempotencyKey, sourceRevision, targetRevision, yearMonth, expectedRevision, expectedDraftRevision,
            humanReviewed, depositScheduleRows, cells, confirmations, managementChecks, managementConfirmations,
            openingBalances, deadlineSummary, "", 0, ""
        );
    }

    public boolean cumulativeV2() {
        return !requestId.isBlank() || !manifestHash.isBlank();
    }

    @AssertTrue(message = "Legacy cashflow month close requires openingBalances.")
    @JsonIgnore
    public boolean isOpeningBalancesContractValid() {
        return cumulativeV2() || openingBalances != null;
    }

    public static CashflowOpeningBalancesResponse requireOpeningBalances(
        CashflowOpeningBalancesResponse value,
        String yearMonth
    ) {
        if (value == null || yearMonth == null || yearMonth.length() < 4) {
            throw new IllegalArgumentException("Cashflow month close requires the JVM opening balance.");
        }
        int selectedYear = Integer.parseInt(yearMonth.substring(0, 4));
        if (value.selectedYear() != selectedYear || value.projection() == null || value.actual() == null) {
            throw new IllegalArgumentException("Cashflow opening balance does not match the close year.");
        }
        requireOpeningBalanceMode(value.projection(), selectedYear, "projection");
        requireOpeningBalanceMode(value.actual(), selectedYear, "actual");
        return value;
    }

    private static void requireOpeningBalanceMode(
        CashflowOpeningBalancesResponse.Mode mode,
        int selectedYear,
        String label
    ) {
        requireWholeWon(mode.amount(), label + " opening balance");
        List<Integer> included = mode.includedYears();
        List<Integer> excludedWeekly = mode.excludedWeeklyYears();
        Map<String, BigDecimal> aggregate = mode.lineAmounts();
        List<CashflowOpeningBalancesResponse.YearSource> sources = mode.sources();
        if (included == null || excludedWeekly == null || aggregate == null || sources == null) {
            throw new IllegalArgumentException("Cashflow opening-balance source years are required.");
        }
        List<Integer> sourceYears = sources.stream().map(CashflowOpeningBalancesResponse.YearSource::year).toList();
        List<Integer> canonicalIncluded = included.stream().distinct().sorted().toList();
        List<Integer> canonicalExcluded = excludedWeekly.stream().distinct().sorted().toList();
        boolean invalidYear = java.util.stream.Stream.concat(canonicalIncluded.stream(), canonicalExcluded.stream())
            .anyMatch(year -> year == null || year < 2000 || year >= selectedYear);
        boolean overlaps = canonicalIncluded.stream().anyMatch(canonicalExcluded::contains);
        if (invalidYear || overlaps || !canonicalIncluded.equals(included) || !canonicalExcluded.equals(excludedWeekly)
            || !canonicalIncluded.equals(sourceYears)) {
            throw new IllegalArgumentException("Cashflow opening-balance source years are not canonical.");
        }
        Map<String, BigDecimal> recomputed = new java.util.TreeMap<>();
        for (CashflowOpeningBalancesResponse.YearSource source : sources) {
            if (source == null || source.lineAmounts() == null || source.lineStates() == null) {
                throw new IllegalArgumentException("Cashflow opening-balance row sources are required.");
            }
            if (!source.lineStates().keySet().equals(new java.util.HashSet<>(CashflowLineCatalog.ALL_LINES))) {
                throw new IllegalArgumentException("Cashflow opening-balance source must preserve every cashflow row state.");
            }
            for (Map.Entry<String, BigDecimal> entry : source.lineAmounts().entrySet()) {
                requireCanonicalOpeningLine(entry.getKey());
                requireWholeWon(entry.getValue(), label + " opening-balance row");
                recomputed.merge(entry.getKey(), entry.getValue(), BigDecimal::add);
            }
            java.util.Set<String> amountLines = new java.util.HashSet<>();
            for (Map.Entry<String, String> entry : source.lineStates().entrySet()) {
                requireCanonicalOpeningLine(entry.getKey());
                if (!List.of("EMPTY", "ZERO", "VALUE").contains(entry.getValue())) {
                    throw new IllegalArgumentException("Cashflow opening-balance row state is invalid.");
                }
                if ("VALUE".equals(entry.getValue())) amountLines.add(entry.getKey());
                if ("ZERO".equals(entry.getValue())) {
                    amountLines.add(entry.getKey());
                    BigDecimal zero = source.lineAmounts().get(entry.getKey());
                    if (zero == null || zero.compareTo(BigDecimal.ZERO) != 0) {
                        throw new IllegalArgumentException("Cashflow opening-balance ZERO row must preserve an explicit zero amount.");
                    }
                }
            }
            if (!source.lineAmounts().keySet().equals(amountLines)) {
                throw new IllegalArgumentException("Cashflow opening-balance row amounts must match their source states.");
            }
        }
        if (!sameAmountMap(aggregate, recomputed)) {
            throw new IllegalArgumentException("Cashflow opening-balance rows do not match their annual sources.");
        }
        BigDecimal recomputedNet = CashflowLineCatalog.IN_LINES.stream()
            .map(line -> aggregate.getOrDefault(line, BigDecimal.ZERO))
            .reduce(BigDecimal.ZERO, BigDecimal::add)
            .subtract(CashflowLineCatalog.OUT_LINES.stream()
                .map(line -> aggregate.getOrDefault(line, BigDecimal.ZERO))
                .reduce(BigDecimal.ZERO, BigDecimal::add));
        if (mode.amount().compareTo(recomputedNet) != 0) {
            throw new IllegalArgumentException("Cashflow opening-balance total does not match its rows.");
        }
    }

    private static void requireCanonicalOpeningLine(String line) {
        if (line == null || !CashflowLineCatalog.ALL_LINES.contains(line)) {
            throw new IllegalArgumentException("Cashflow opening-balance row is invalid.");
        }
    }

    private static boolean sameAmountMap(Map<String, BigDecimal> left, Map<String, BigDecimal> right) {
        if (left.size() != right.size() || !left.keySet().equals(right.keySet())) return false;
        return left.entrySet().stream().allMatch(entry -> {
            BigDecimal other = right.get(entry.getKey());
            return entry.getValue() != null && other != null && entry.getValue().compareTo(other) == 0;
        });
    }

    public static List<DepositScheduleRow> requireCompleteDepositSchedule(List<DepositScheduleRow> rows) {
        if (rows == null || rows.size() != CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) {
            throw new IllegalArgumentException("Cashflow month close requires one deposit schedule decision for each of five weeks.");
        }
        Map<Integer, DepositScheduleRow> byWeek = new LinkedHashMap<>();
        for (DepositScheduleRow row : rows) {
            if (row == null || row.weekNo() < 1 || row.weekNo() > CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) {
                throw new IllegalArgumentException("Cashflow deposit schedule week must be between 1 and 5.");
            }
            if (byWeek.putIfAbsent(row.weekNo(), row) != null) {
                throw new IllegalArgumentException("Cashflow deposit schedule contains a duplicate week.");
            }
            requireCalendarDate(row.taxInvoiceIssuedDate(), "tax invoice issued date");
            requireCalendarDate(row.expectedDepositDate(), "expected deposit date");
            requireCalendarDate(row.actualDepositDate(), "actual deposit date");
            requireWholeWon(row.expectedDepositAmount(), "expected deposit amount");
            requireWholeWon(row.actualDepositAmount(), "actual deposit amount");
            boolean hasExpected = !row.taxInvoiceIssuedDate().isBlank()
                || !row.expectedDepositDate().isBlank()
                || row.expectedDepositAmount() != null;
            boolean hasActual = !row.actualDepositDate().isBlank() || row.actualDepositAmount() != null;
            if ("NOT_APPLICABLE".equals(row.decision())) {
                if (hasExpected || hasActual || !"NOT_APPLICABLE".equals(row.actualSource())) {
                    throw new IllegalArgumentException("A NOT_APPLICABLE deposit week cannot contain deposit values.");
                }
            } else if (!"CONFIRMED".equals(row.decision()) || (!hasExpected && !hasActual)) {
                throw new IllegalArgumentException("A deposit week with values must be explicitly CONFIRMED.");
            }
            if (hasActual == "NOT_APPLICABLE".equals(row.actualSource())) {
                throw new IllegalArgumentException("Actual deposit values require their canonical source, and an empty actual requires NOT_APPLICABLE.");
            }
        }
        for (int weekNo = 1; weekNo <= CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT; weekNo += 1) {
            if (!byWeek.containsKey(weekNo)) {
                throw new IllegalArgumentException("Cashflow deposit schedule requires weeks 1 through 5.");
            }
        }
        return List.copyOf(byWeek.values());
    }

    private static void requireCalendarDate(String value, String field) {
        if (value == null || value.isBlank()) return;
        try {
            LocalDate.parse(value);
        } catch (DateTimeParseException error) {
            throw new IllegalArgumentException("Cashflow " + field + " must be a real YYYY-MM-DD date.");
        }
    }

    private static void requireWholeWon(BigDecimal value, String field) {
        if (value == null) return;
        try {
            value.longValueExact();
        } catch (ArithmeticException error) {
            throw new IllegalArgumentException("Cashflow " + field + " must be a whole won value in the supported range.");
        }
    }

    public static List<Confirmation> requireCompleteConfirmations(List<Confirmation> confirmations) {
        if (confirmations == null || confirmations.size() != CashflowSheetLabApplyRequest.EXPECTED_CELL_COUNT) {
            throw new IllegalArgumentException("Cashflow month close requires a decision for all 160 cells.");
        }
        Map<String, Confirmation> byKey = new LinkedHashMap<>();
        for (Confirmation confirmation : confirmations) {
            if (confirmation == null
                || confirmation.weekNo() < 1
                || confirmation.weekNo() > CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT) {
                throw new IllegalArgumentException("Cashflow month close requires decisions for exactly five weeks.");
            }
            String mode = confirmation.mode() == null ? "" : confirmation.mode().trim().toLowerCase(Locale.ROOT);
            if (!"projection".equals(mode) && !"actual".equals(mode)) {
                throw new IllegalArgumentException("Cashflow confirmation mode must be projection or actual.");
            }
            String line = CashflowLineCatalog.canonicalize(confirmation.cashflowLine());
            if (line.isBlank() || !CashflowLineCatalog.ALL_LINES.contains(line)) {
                throw new IllegalArgumentException("Unsupported cashflow line.");
            }
            String decision = confirmation.decision() == null
                ? ""
                : confirmation.decision().trim().toUpperCase(Locale.ROOT);
            if (!"CONFIRMED".equals(decision) && !"NOT_APPLICABLE".equals(decision)) {
                throw new IllegalArgumentException("Cashflow confirmation decision must be CONFIRMED or NOT_APPLICABLE.");
            }
            Confirmation canonical = new Confirmation(mode, confirmation.weekNo(), line, decision);
            String key = mode + ":" + confirmation.weekNo() + ":" + line;
            if (byKey.putIfAbsent(key, canonical) != null) {
                throw new IllegalArgumentException("Cashflow month close contains duplicate confirmations.");
            }
        }
        for (int weekNo = 1; weekNo <= CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT; weekNo += 1) {
            for (String mode : List.of("projection", "actual")) {
                for (String line : CashflowLineCatalog.ALL_LINES) {
                    if (!byKey.containsKey(mode + ":" + weekNo + ":" + line)) {
                        throw new IllegalArgumentException("Cashflow month close requires a decision for every cell.");
                    }
                }
            }
        }
        return List.copyOf(byKey.values());
    }

    public static void requireHumanReviewed(boolean humanReviewed) {
        if (!humanReviewed) {
            throw new IllegalArgumentException("Cashflow month close requires an explicit human review.");
        }
    }

    public static List<ManagementCheck> requireCompleteManagementChecks(List<ManagementCheck> checks) {
        if (checks == null || checks.size() != MANAGEMENT_CHECK_IDS.size()) {
            throw new IllegalArgumentException("Cashflow month close requires all four management checks.");
        }
        Map<String, ManagementCheck> byId = new LinkedHashMap<>();
        for (ManagementCheck check : checks) {
            if (check == null || !MANAGEMENT_CHECK_IDS.contains(check.id())) {
                throw new IllegalArgumentException("Unsupported cashflow management check.");
            }
            String status = check.status() == null ? "" : check.status().trim().toUpperCase(Locale.ROOT);
            String title = check.title() == null ? "" : check.title().trim();
            String detail = check.detail() == null ? "" : check.detail().trim();
            if (!List.of("OK", "WARNING", "REVIEW_REQUIRED").contains(status) || title.isBlank() || detail.isBlank()) {
                throw new IllegalArgumentException("Cashflow management check status, title, and detail are required.");
            }
            ManagementCheck canonical = new ManagementCheck(check.id(), status, title, detail, check.findings());
            if (byId.putIfAbsent(check.id(), canonical) != null) {
                throw new IllegalArgumentException("Cashflow month close contains duplicate management checks.");
            }
        }
        return MANAGEMENT_CHECK_IDS.stream().map(byId::get).toList();
    }

    public static List<ManagementConfirmation> requireCompleteManagementConfirmations(List<ManagementConfirmation> confirmations) {
        if (confirmations == null || confirmations.isEmpty()) return List.of();
        if (confirmations.size() != MANAGEMENT_CHECK_IDS.size()) {
            throw new IllegalArgumentException("Cashflow month close requires a decision for all four management checks.");
        }
        Map<String, ManagementConfirmation> byId = new LinkedHashMap<>();
        for (ManagementConfirmation confirmation : confirmations) {
            if (confirmation == null || !MANAGEMENT_CHECK_IDS.contains(confirmation.checkId())) {
                throw new IllegalArgumentException("Unsupported cashflow management confirmation.");
            }
            String decision = confirmation.decision() == null
                ? ""
                : confirmation.decision().trim().toUpperCase(Locale.ROOT);
            if (!List.of("CONFIRMED", "NOT_APPLICABLE").contains(decision)) {
                throw new IllegalArgumentException("Cashflow management confirmation decision is invalid.");
            }
            ManagementConfirmation canonical = new ManagementConfirmation(confirmation.checkId(), decision);
            if (byId.putIfAbsent(confirmation.checkId(), canonical) != null) {
                throw new IllegalArgumentException("Cashflow month close contains duplicate management confirmations.");
            }
        }
        return MANAGEMENT_CHECK_IDS.stream().map(byId::get).toList();
    }
}
