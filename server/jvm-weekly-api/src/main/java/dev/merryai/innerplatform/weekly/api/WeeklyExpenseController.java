package dev.merryai.innerplatform.weekly.api;

import jakarta.servlet.http.HttpServletRequest;
import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import jakarta.validation.Valid;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
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
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;

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
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private final WeeklyExpenseCommandService commandService;
    private final WeeklyExpensePersistence persistence;
    private final boolean legacyWeekCloseEnabled;

    public WeeklyExpenseController(
        WeeklyExpenseCommandService commandService,
        WeeklyExpensePersistence persistence,
        @Value("${weekly.legacy-week-close-enabled:false}") boolean legacyWeekCloseEnabled
    ) {
        this.commandService = commandService;
        this.persistence = persistence;
        this.legacyWeekCloseEnabled = legacyWeekCloseEnabled;
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
        HttpServletRequest httpRequest,
        @Valid @RequestBody SaveDraftRequest request
    ) {
        return commandService.saveDraft(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            sheetKey,
            editSession(httpRequest),
            request
        );
    }

    @GetMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}")
    public WeeklyExpenseSheetResponse readSheet(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        return commandService.readSheet(actorContext(tenantId, actorId, actorRole, actorEmail), projectId, sheetKey);
    }

    @GetMapping("/weekly-expenses/{projectId}/sheets")
    public WeeklyExpenseSheetsResponse listSheets(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        return commandService.listSheets(actorContext(tenantId, actorId, actorRole, actorEmail), projectId);
    }

    @PostMapping("/weekly-expenses/{projectId}/bank-statements/import-batch")
    public ImportBankStatementBatchResponse importBankStatementBatch(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody ImportBankStatementBatchRequest request
    ) {
        return commandService.importBankStatementBatch(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
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
        HttpServletRequest httpRequest,
        @Valid @RequestBody ApplyBankStatementItemsRequest request
    ) {
        return commandService.applyBankStatementItems(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/cell-patch")
    public CellCommandResponse patchCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CellPatchCommandRequest request
    ) {
        return commandService.patchCells(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            sheetKey,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/paste")
    public CellCommandResponse pasteCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody PasteCellsRequest request
    ) {
        return commandService.pasteCells(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            sheetKey,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/copy")
    public CellCommandResponse copyCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CopyCellsRequest request
    ) {
        return commandService.copyCells(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            sheetKey,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/cut")
    public CellCommandResponse cutCells(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CutCellsRequest request
    ) {
        return commandService.cutCells(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            sheetKey,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/row-insert")
    public RowCommandResponse insertRows(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody RowInsertRequest request
    ) {
        return commandService.insertRows(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            sheetKey,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/row-delete")
    public RowCommandResponse deleteRows(
        @PathVariable String projectId,
        @PathVariable String sheetKey,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody RowDeleteRequest request
    ) {
        return commandService.deleteRows(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            sheetKey,
            editSession(httpRequest),
            request
        );
    }

    @GetMapping("/cashflow/{projectId}")
    public CashflowSnapshotResponse cashflowSnapshot(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        commandService.requireProjectAllowed(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, actorContext(tenantId, actorId, actorRole, actorEmail), projectId);
        List<CashflowSnapshotResponse.ProjectionLine> projection = persistence.findProjectionLines(tenantId, projectId).stream()
            .map(line -> new CashflowSnapshotResponse.ProjectionLine(
                line.getYearMonth(),
                line.getWeekNo(),
                line.getCashflowLine(),
                line.getAmount()
            ))
            .toList();
        List<CashflowSnapshotResponse.ActualLine> actual = persistence.findActualLines(tenantId, projectId).stream()
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
        HttpServletRequest httpRequest,
        @Valid @RequestBody UpsertProjectionRequest request
    ) {
        return commandService.upsertProjection(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/cashflow/{projectId}/variance")
    public CashflowVarianceResponse updateCashflowVariance(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CashflowVarianceRequest request
    ) {
        return commandService.updateCashflowVariance(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @GetMapping("/cashflow/{projectId}/month-close")
    public CashflowMonthCloseResponse readCashflowMonthClose(
        @PathVariable String projectId,
        @RequestParam("yearMonth") String yearMonth,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        return commandService.readCashflowMonthClose(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            yearMonth
        );
    }

    @GetMapping("/cashflow/{projectId}/month-close/dashboard-source")
    public CashflowMonthDashboardSourceResponse readCashflowMonthDashboardSource(
        @PathVariable String projectId,
        @RequestParam("yearMonth") String yearMonth,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        CashflowMonthCloseResponse monthClose = commandService.readCashflowMonthClose(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            yearMonth
        );
        CashflowSnapshotResponse cashflow = "OPEN".equals(monthClose.status())
            ? cashflowSnapshot(projectId, tenantId, actorId, actorRole, actorEmail)
            : null;
        return new CashflowMonthDashboardSourceResponse(monthClose, cashflow);
    }

    @PostMapping("/cashflow/{projectId}/month-close")
    public CashflowMonthCloseResponse closeCashflowMonth(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CloseCashflowMonthRequest request
    ) {
        return commandService.closeCashflowMonth(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/cashflow/{projectId}/weekly-update-complete")
    public CashflowWeeklyUpdateCompletionResponse completeCashflowWeeklyUpdate(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        @Valid @RequestBody CompleteCashflowWeeklyUpdateRequest request
    ) {
        return commandService.completeCashflowWeeklyUpdate(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            request
        );
    }

    @PostMapping("/cashflow/{projectId}/month-close/reopen-request")
    public CashflowMonthCloseResponse requestCashflowMonthReopen(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody RequestCashflowMonthReopenRequest request
    ) {
        return commandService.requestCashflowMonthReopen(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            httpRequest.getHeader("x-data-project-id"),
            request
        );
    }

    @PostMapping("/cashflow/{projectId}/month-close/reopen-decision")
    public CashflowMonthCloseResponse decideCashflowMonthReopen(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody DecideCashflowMonthReopenRequest request
    ) {
        return commandService.decideCashflowMonthReopen(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            httpRequest.getHeader("x-data-project-id"),
            request
        );
    }

    @PostMapping("/cashflow/{projectId}/sheet-lab/apply")
    public CashflowSheetLabApplyResponse applyCashflowSheetLab(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CashflowSheetLabApplyRequest request
    ) {
        return commandService.applyCashflowSheetLab(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/cashflow/{projectId}/sheet-lab/annual/apply")
    public CashflowSheetAnnualApplyResponse applyCashflowSheetAnnualTotal(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CashflowSheetAnnualApplyRequest request
    ) {
        return commandService.applyCashflowSheetAnnualTotal(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/submit")
    public SubmitWeekResponse submitWeek(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody SubmitWeekRequest request
    ) {
        if (!legacyWeekCloseEnabled) {
            throw new ResponseStatusException(HttpStatus.GONE, "Weekly submit is disabled; use cashflow month close.");
        }
        return commandService.submitWeek(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @PostMapping("/weekly-expenses/{projectId}/close")
    public CloseWeekResponse closeWeek(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail,
        HttpServletRequest httpRequest,
        @Valid @RequestBody CloseWeekRequest request
    ) {
        if (!legacyWeekCloseEnabled) {
            throw new ResponseStatusException(HttpStatus.GONE, "Weekly close is disabled; use cashflow month close.");
        }
        return commandService.closeWeek(
            actorContext(tenantId, actorId, actorRole, actorEmail),
            projectId,
            editSession(httpRequest),
            request
        );
    }

    @GetMapping("/weekly-expenses/{projectId}/statuses")
    public WeeklyExpenseStatusesResponse weeklyStatuses(
        @PathVariable String projectId,
        @RequestHeader("x-tenant-id") String tenantId,
        @RequestHeader("x-actor-id") String actorId,
        @RequestHeader("x-actor-role") String actorRole,
        @RequestHeader(value = "x-actor-email", required = false) String actorEmail
    ) {
        commandService.requireProjectAllowed(WeeklyExpenseCommandService.WEEKLY_STATUS_READ_COMMAND, actorContext(tenantId, actorId, actorRole, actorEmail), projectId);
        return new WeeklyExpenseStatusesResponse(
            projectId,
            persistence.findWeeklyStatuses(tenantId, projectId).stream()
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
                BigDecimal weekIn = sumLines(weekAmounts, CashflowLineCatalog.IN_LINES);
                BigDecimal weekOut = sumLines(weekAmounts, CashflowLineCatalog.OUT_LINES);
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
        return CashflowLineCatalog.canonicalize(raw);
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
        ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        String actorName = attrs == null ? "" : attrs.getRequest().getHeader("x-actor-name");
        return new TrustedActorContext(tenantId, actorId, actorEmail, actorRole, actorName);
    }

    private CashflowEditSession editSession(
        String dataProjectId,
        String sessionId,
        String leaseId,
        String fenceValue,
        String finalizeValue
    ) {
        long fence = 0;
        if (fenceValue != null && !fenceValue.isBlank()) {
            String normalizedFence = fenceValue.trim();
            if (!normalizedFence.matches("^[1-9]\\d*$")) {
                throw new IllegalArgumentException("x-edit-fence must be a positive integer.");
            }
            try {
                fence = Long.parseLong(normalizedFence);
            } catch (NumberFormatException error) {
                throw new IllegalArgumentException("x-edit-fence must be a positive integer.");
            }
            if (fence > MAX_SAFE_INTEGER) {
                throw new IllegalArgumentException("x-edit-fence must be a positive integer.");
            }
        }
        String normalizedFinalize = finalizeValue == null ? "" : finalizeValue.trim();
        if (!normalizedFinalize.isEmpty() && !"true".equals(normalizedFinalize)) {
            throw new IllegalArgumentException("x-edit-finalize must be true when present.");
        }
        return new CashflowEditSession(dataProjectId, sessionId, leaseId, fence, "true".equals(normalizedFinalize));
    }

    private CashflowEditSession editSession(HttpServletRequest request) {
        return editSession(
            request.getHeader("x-data-project-id"),
            request.getHeader("x-edit-session-id"),
            request.getHeader("x-edit-lease-id"),
            request.getHeader("x-edit-fence"),
            request.getHeader("x-edit-finalize")
        );
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

    @org.springframework.web.bind.annotation.ExceptionHandler(WeeklyExpenseAtomicWriteLimitException.class)
    public ResponseEntity<Map<String, Object>> atomicWriteLimit(WeeklyExpenseAtomicWriteLimitException error) {
        return ResponseEntity.status(error.statusCode()).body(Map.of(
            "ok", false,
            "code", error.code(),
            "message", error.getMessage(),
            "expectedWriteCount", error.expectedWriteCount()
        ));
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(WeeklyExpenseEditLeaseException.class)
    public ResponseEntity<Map<String, String>> editLease(WeeklyExpenseEditLeaseException error) {
        return ResponseEntity.status(error.statusCode()).body(Map.of(
            "ok", "false",
            "code", error.code(),
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
