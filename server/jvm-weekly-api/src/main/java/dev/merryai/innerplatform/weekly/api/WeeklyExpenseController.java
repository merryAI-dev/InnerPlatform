package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import jakarta.validation.Valid;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseActualRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseProjectionRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseWeeklyStatusRepository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

@RestController
@RequestMapping("/api/v1")
public class WeeklyExpenseController {
    private static final Set<String> CASHFLOW_IN_LINES = Set.of(
        "MYSC_PREPAY_IN",
        "SALES_IN",
        "SALES_VAT_IN",
        "TEAM_SUPPORT_IN",
        "BANK_INTEREST_IN"
    );
    private static final Set<String> CASHFLOW_OUT_LINES = Set.of(
        "DIRECT_COST_OUT",
        "INPUT_VAT_OUT",
        "MYSC_LABOR_OUT",
        "MYSC_PROFIT_OUT",
        "SALES_VAT_OUT",
        "TEAM_SUPPORT_OUT",
        "BANK_INTEREST_OUT"
    );
    private static final Map<String, String> CASHFLOW_LINE_ALIASES = Map.ofEntries(
        Map.entry("MYSC_PREPAY_IN", "MYSC_PREPAY_IN"),
        Map.entry("MYSC 선입금(잔금 등 입금 필요 시)", "MYSC_PREPAY_IN"),
        Map.entry("MYSC선입금", "MYSC_PREPAY_IN"),
        Map.entry("SALES_IN", "SALES_IN"),
        Map.entry("매출액(입금)", "SALES_IN"),
        Map.entry("매출액", "SALES_IN"),
        Map.entry("SALES_VAT_IN", "SALES_VAT_IN"),
        Map.entry("매출부가세(입금)", "SALES_VAT_IN"),
        Map.entry("매출부가세", "SALES_VAT_IN"),
        Map.entry("TEAM_SUPPORT_IN", "TEAM_SUPPORT_IN"),
        Map.entry("팀지원금(입금)", "TEAM_SUPPORT_IN"),
        Map.entry("BANK_INTEREST_IN", "BANK_INTEREST_IN"),
        Map.entry("은행이자(입금)", "BANK_INTEREST_IN"),
        Map.entry("DIRECT_COST_OUT", "DIRECT_COST_OUT"),
        Map.entry("직접사업비", "DIRECT_COST_OUT"),
        Map.entry("사업비", "DIRECT_COST_OUT"),
        Map.entry("직접사업비(공급가액)", "DIRECT_COST_OUT"),
        Map.entry("직접사업비(공급가액)+매입부가세", "DIRECT_COST_OUT"),
        Map.entry("INPUT_VAT_OUT", "INPUT_VAT_OUT"),
        Map.entry("매입부가세", "INPUT_VAT_OUT"),
        Map.entry("MYSC_LABOR_OUT", "MYSC_LABOR_OUT"),
        Map.entry("MYSC 인건비", "MYSC_LABOR_OUT"),
        Map.entry("MYSC인건비", "MYSC_LABOR_OUT"),
        Map.entry("MYSC_PROFIT_OUT", "MYSC_PROFIT_OUT"),
        Map.entry("MYSC 수익(간접비 등)", "MYSC_PROFIT_OUT"),
        Map.entry("MYSC수익", "MYSC_PROFIT_OUT"),
        Map.entry("SALES_VAT_OUT", "SALES_VAT_OUT"),
        Map.entry("매출부가세(출금)", "SALES_VAT_OUT"),
        Map.entry("TEAM_SUPPORT_OUT", "TEAM_SUPPORT_OUT"),
        Map.entry("팀지원금(출금)", "TEAM_SUPPORT_OUT"),
        Map.entry("BANK_INTEREST_OUT", "BANK_INTEREST_OUT"),
        Map.entry("은행이자(출금)", "BANK_INTEREST_OUT")
    );

    private final WeeklyExpenseCommandService commandService;
    private final WeeklyExpenseActualRepository actualRepository;
    private final WeeklyExpenseProjectionRepository projectionRepository;
    private final WeeklyExpenseWeeklyStatusRepository weeklyStatusRepository;

    public WeeklyExpenseController(
        WeeklyExpenseCommandService commandService,
        WeeklyExpenseActualRepository actualRepository,
        WeeklyExpenseProjectionRepository projectionRepository,
        WeeklyExpenseWeeklyStatusRepository weeklyStatusRepository
    ) {
        this.commandService = commandService;
        this.actualRepository = actualRepository;
        this.projectionRepository = projectionRepository;
        this.weeklyStatusRepository = weeklyStatusRepository;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "service", "jvm-weekly-api", "runtime", "spring-boot");
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/save-draft")
    public SaveDraftResponse saveDraft(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody SaveDraftRequest request
    ) {
        return commandService.saveDraft(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/bank-statements/import-batch")
    public ImportBankStatementBatchResponse importBankStatementBatch(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody ImportBankStatementBatchRequest request
    ) {
        return commandService.importBankStatementBatch(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, request);
    }

    @GetMapping("/weekly-expenses/{projectId}/bank-statements/import-lines")
    public BankStatementImportLinesResponse listBankStatementImportLines(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @RequestParam(value = "status", required = false) String status
    ) {
        return commandService.listBankStatementImportLines(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            status
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/bank-statements/apply-items")
    public ApplyBankStatementItemsResponse applyBankStatementItems(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody ApplyBankStatementItemsRequest request
    ) {
        return commandService.applyBankStatementItems(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/cell-patch")
    public CellCommandResponse patchCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody CellPatchCommandRequest request
    ) {
        return commandService.patchCells(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/paste")
    public CellCommandResponse pasteCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody PasteCellsRequest request
    ) {
        return commandService.pasteCells(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/copy")
    public CellCommandResponse copyCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody CopyCellsRequest request
    ) {
        return commandService.copyCells(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/cut")
    public CellCommandResponse cutCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody CutCellsRequest request
    ) {
        return commandService.cutCells(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/row-insert")
    public RowCommandResponse insertRows(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody RowInsertRequest request
    ) {
        return commandService.insertRows(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/row-delete")
    public RowCommandResponse deleteRows(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody RowDeleteRequest request
    ) {
        return commandService.deleteRows(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey, request);
    }

    @GetMapping("/cashflow/{projectId}")
    public CashflowSnapshotResponse cashflowSnapshot(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        commandService.requireAllowed(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, actorContext(tenantId, actorId, actorRole, actorEmail));
        List<CashflowSnapshotResponse.ProjectionLine> projection = projectionRepository.findByTenantIdAndProjectId(tenantId, projectId).stream()
            .map(line -> new CashflowSnapshotResponse.ProjectionLine(
                line.getYearMonth(),
                line.getWeekNo(),
                line.getCashflowLine(),
                line.getAmount()
            ))
            .toList();
        List<CashflowSnapshotResponse.ActualLine> actual = actualRepository.findByTenantIdAndProjectId(tenantId, projectId).stream()
            .map(line -> new CashflowSnapshotResponse.ActualLine(
                line.getSheetKey(),
                line.getYearMonth(),
                line.getWeekNo(),
                line.getCashflowLine(),
                line.getAmount()
            ))
            .toList();
        return new CashflowSnapshotResponse(
            projectId,
            projection,
            actual,
            buildCashflowReadModel(projection, actual)
        );
    }

    @PostMapping("/cashflow/{projectId}/projection")
    public UpsertProjectionResponse upsertProjection(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody UpsertProjectionRequest request
    ) {
        return commandService.upsertProjection(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/submit")
    public SubmitWeekResponse submitWeek(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody SubmitWeekRequest request
    ) {
        return commandService.submitWeek(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, request);
    }

    @PostMapping("/weekly-expenses/{projectId}/close")
    public CloseWeekResponse closeWeek(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody CloseWeekRequest request
    ) {
        return commandService.closeWeek(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, request);
    }

    @GetMapping("/weekly-expenses/{projectId}/statuses")
    public WeeklyExpenseStatusesResponse weeklyStatuses(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        commandService.requireAllowed(WeeklyExpenseCommandService.WEEKLY_STATUS_READ_COMMAND, actorContext(tenantId, actorId, actorRole, actorEmail));
        return new WeeklyExpenseStatusesResponse(
            projectId,
            weeklyStatusRepository.findByTenantIdAndProjectIdOrderByYearMonthDescWeekNoAsc(tenantId, projectId).stream()
                .map(status -> new WeeklyExpenseStatusesResponse.WeeklyStatusLine(
                    status.getProjectId() + "-" + status.getYearMonth() + "-w" + status.getWeekNo(),
                    status.getProjectId(),
                    status.getYearMonth(),
                    status.getWeekNo(),
                    status.getState(),
                    status.getSubmittedAt() != null,
                    status.getSubmittedBy(),
                    status.getSubmittedAt(),
                    "closed".equals(status.getState()),
                    status.getClosedBy(),
                    status.getClosedAt(),
                    status.getUpdatedAt()
                ))
                .toList()
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/audit-export")
    public CreateAuditExportResponse createAuditExport(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody CreateAuditExportRequest request
    ) {
        return commandService.createAuditExport(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, request);
    }

    private CashflowSnapshotResponse.ReadModel buildCashflowReadModel(
        List<CashflowSnapshotResponse.ProjectionLine> projection,
        List<CashflowSnapshotResponse.ActualLine> actual
    ) {
        Map<String, CashflowSnapshotResponse.ModeReadModel> projectionByMonth = buildModeReadModel(
            projection.stream()
                .map(line -> new CashflowAmountLine(line.yearMonth(), line.weekNo(), line.cashflowLine(), line.amount()))
                .toList()
        );
        Map<String, CashflowSnapshotResponse.ModeReadModel> actualByMonth = buildModeReadModel(
            actual.stream()
                .map(line -> new CashflowAmountLine(line.yearMonth(), line.weekNo(), line.cashflowLine(), line.amount()))
                .toList()
        );
        LinkedHashSet<String> yearMonths = new LinkedHashSet<>();
        yearMonths.addAll(projectionByMonth.keySet());
        yearMonths.addAll(actualByMonth.keySet());
        return new CashflowSnapshotResponse.ReadModel(
            yearMonths.stream()
                .sorted()
                .map(yearMonth -> new CashflowSnapshotResponse.MonthReadModel(
                    yearMonth,
                    projectionByMonth.getOrDefault(yearMonth, emptyModeReadModel()),
                    actualByMonth.getOrDefault(yearMonth, emptyModeReadModel())
                ))
                .toList()
        );
    }

    private Map<String, CashflowSnapshotResponse.ModeReadModel> buildModeReadModel(List<CashflowAmountLine> lines) {
        Map<String, Map<Integer, Map<String, BigDecimal>>> amountsByMonth = new TreeMap<>();
        for (CashflowAmountLine line : lines) {
            String lineId = canonicalCashflowLine(line.cashflowLine());
            if (lineId.isBlank()) continue;
            amountsByMonth
                .computeIfAbsent(line.yearMonth(), ignored -> new TreeMap<>())
                .computeIfAbsent(line.weekNo(), ignored -> new LinkedHashMap<>())
                .merge(lineId, safeAmount(line.amount()), BigDecimal::add);
        }

        Map<String, CashflowSnapshotResponse.ModeReadModel> readModels = new LinkedHashMap<>();
        BigDecimal runningIn = BigDecimal.ZERO;
        BigDecimal runningOut = BigDecimal.ZERO;
        for (Map.Entry<String, Map<Integer, Map<String, BigDecimal>>> monthEntry : amountsByMonth.entrySet()) {
            Map<String, BigDecimal> rowTotals = new LinkedHashMap<>();
            List<CashflowSnapshotResponse.WeekReadModel> weekModels = new ArrayList<>();
            BigDecimal monthIn = BigDecimal.ZERO;
            BigDecimal monthOut = BigDecimal.ZERO;
            for (Map.Entry<Integer, Map<String, BigDecimal>> weekEntry : monthEntry.getValue().entrySet()) {
                Map<String, BigDecimal> weekAmounts = sortedAmounts(weekEntry.getValue());
                for (Map.Entry<String, BigDecimal> amountEntry : weekAmounts.entrySet()) {
                    rowTotals.merge(amountEntry.getKey(), amountEntry.getValue(), BigDecimal::add);
                }
                BigDecimal weekIn = sumLines(weekAmounts, CASHFLOW_IN_LINES);
                BigDecimal weekOut = sumLines(weekAmounts, CASHFLOW_OUT_LINES);
                monthIn = monthIn.add(weekIn);
                monthOut = monthOut.add(weekOut);
                runningIn = runningIn.add(weekIn);
                runningOut = runningOut.add(weekOut);
                weekModels.add(new CashflowSnapshotResponse.WeekReadModel(
                    weekEntry.getKey(),
                    weekAmounts,
                    weekIn,
                    weekOut,
                    runningIn.subtract(runningOut),
                    weekIn,
                    weekOut
                ));
            }
            readModels.put(monthEntry.getKey(), new CashflowSnapshotResponse.ModeReadModel(
                sortedAmounts(rowTotals),
                weekModels,
                new CashflowSnapshotResponse.CashflowTotals(
                    monthIn,
                    monthOut,
                    runningIn.subtract(runningOut)
                )
            ));
        }
        return readModels;
    }

    private CashflowSnapshotResponse.ModeReadModel emptyModeReadModel() {
        return new CashflowSnapshotResponse.ModeReadModel(
            Map.of(),
            List.of(),
            new CashflowSnapshotResponse.CashflowTotals(BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO)
        );
    }

    private String canonicalCashflowLine(String raw) {
        String normalized = raw == null ? "" : raw.replaceAll("\\s+", " ").trim();
        if (normalized.isBlank()) return "";
        String direct = CASHFLOW_LINE_ALIASES.get(normalized);
        if (direct != null) return direct;
        return CASHFLOW_LINE_ALIASES.getOrDefault(normalized.replaceAll("\\s+", ""), normalized);
    }

    private Map<String, BigDecimal> sortedAmounts(Map<String, BigDecimal> amounts) {
        return amounts.entrySet().stream()
            .sorted(Comparator.comparing(Map.Entry::getKey))
            .collect(
                LinkedHashMap::new,
                (target, entry) -> target.put(entry.getKey(), safeAmount(entry.getValue())),
                LinkedHashMap::putAll
            );
    }

    private BigDecimal sumLines(Map<String, BigDecimal> amounts, Set<String> lineIds) {
        return amounts.entrySet().stream()
            .filter(entry -> lineIds.contains(entry.getKey()))
            .map(entry -> safeAmount(entry.getValue()))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private BigDecimal safeAmount(BigDecimal amount) {
        return amount == null ? BigDecimal.ZERO : amount;
    }

    private TrustedActorContext actorContext(String tenantId, String actorId, String actorRole, String actorEmail) {
        return new TrustedActorContext(tenantId, actorId, actorEmail, actorRole);
    }

    private record CashflowAmountLine(
        String yearMonth,
        int weekNo,
        String cashflowLine,
        BigDecimal amount
    ) {
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(WeeklyExpenseConflictException.class)
    public ResponseEntity<Map<String, String>> conflict(WeeklyExpenseConflictException error) {
        return ResponseEntity.status(409).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_conflict",
            "message", error.getMessage()
        ));
    }

    @org.springframework.web.bind.annotation.ExceptionHandler({
        DataIntegrityViolationException.class,
        ObjectOptimisticLockingFailureException.class
    })
    public ResponseEntity<Map<String, String>> persistenceConflict(Exception error) {
        return ResponseEntity.status(409).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_persistence_conflict",
            "message", "The weekly expense sheet changed while this command was running. Reload and retry."
        ));
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException error) {
        return ResponseEntity.status(400).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_bad_request",
            "message", error.getMessage()
        ));
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> invalidJson(HttpMessageNotReadableException error) {
        return ResponseEntity.status(400).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_invalid_json",
            "message", "Request body contains invalid or unsupported fields."
        ));
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> validationFailed(MethodArgumentNotValidException error) {
        String field = error.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(fieldError -> fieldError.getField())
            .orElse("request");
        return ResponseEntity.status(400).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_validation_failed",
            "message", "Invalid weekly expense request field: " + field
        ));
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(WeeklyExpenseForbiddenException.class)
    public ResponseEntity<Map<String, String>> forbidden(WeeklyExpenseForbiddenException error) {
        return ResponseEntity.status(403).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_forbidden",
            "message", error.getMessage()
        ));
    }
}
