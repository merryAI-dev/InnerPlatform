package dev.merryai.innerplatform.weekly.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.api.CellCommandResponse;
import dev.merryai.innerplatform.weekly.api.CellPatchCommandRequest;
import dev.merryai.innerplatform.weekly.api.CashflowSnapshotResponse;
import dev.merryai.innerplatform.weekly.api.CloseWeekRequest;
import dev.merryai.innerplatform.weekly.api.CloseWeekResponse;
import dev.merryai.innerplatform.weekly.api.ApplyBankStatementItemsRequest;
import dev.merryai.innerplatform.weekly.api.ApplyBankStatementItemsResponse;
import dev.merryai.innerplatform.weekly.api.BankStatementImportLinesResponse;
import dev.merryai.innerplatform.weekly.api.CopyCellsRequest;
import dev.merryai.innerplatform.weekly.api.CreateAuditExportRequest;
import dev.merryai.innerplatform.weekly.api.CreateAuditExportResponse;
import dev.merryai.innerplatform.weekly.api.CutCellsRequest;
import dev.merryai.innerplatform.weekly.api.ImportBankStatementBatchRequest;
import dev.merryai.innerplatform.weekly.api.ImportBankStatementBatchResponse;
import dev.merryai.innerplatform.weekly.api.PasteCellsRequest;
import dev.merryai.innerplatform.weekly.api.RowCommandResponse;
import dev.merryai.innerplatform.weekly.api.RowDeleteRequest;
import dev.merryai.innerplatform.weekly.api.RowInsertRequest;
import dev.merryai.innerplatform.weekly.api.SaveDraftRequest;
import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;
import dev.merryai.innerplatform.weekly.api.SubmitWeekRequest;
import dev.merryai.innerplatform.weekly.api.SubmitWeekResponse;
import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionRequest;
import dev.merryai.innerplatform.weekly.api.UpsertProjectionResponse;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseConflictException;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseRequestLimits;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseSheetResponse;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseSheetsResponse;
import dev.merryai.innerplatform.weekly.domain.CellValidationIssue;
import dev.merryai.innerplatform.weekly.domain.CellAddress;
import dev.merryai.innerplatform.weekly.domain.CellValidationStatus;
import dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog;
import dev.merryai.innerplatform.weekly.domain.ClipboardCell;
import dev.merryai.innerplatform.weekly.domain.ClipboardPayload;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseActualEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditEventEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseAuditExportEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportBatchEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseBankImportLineEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseCellEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseColumn;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseFormulaEngine;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseProjectionEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseRowEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSheetEntity;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseSpreadsheetService;
import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseWeeklyStatusEntity;
import dev.merryai.innerplatform.weekly.domain.PasteResult;
import dev.merryai.innerplatform.weekly.domain.SpreadsheetOperationType;
import dev.merryai.innerplatform.weekly.domain.SpreadsheetSelection;
import dev.merryai.innerplatform.weekly.domain.SpreadsheetValueType;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class WeeklyExpenseCommandService {
    public static final String SAVE_DRAFT_COMMAND = "weeklyExpense.saveDraft";
    public static final String SHEET_READ_COMMAND = "weeklyExpense.sheet.read";
    public static final String BANK_IMPORT_BATCH_COMMAND = "weeklyExpense.bankStatement.importBatch";
    public static final String BANK_IMPORT_LIST_LINES_COMMAND = "weeklyExpense.bankStatement.listLines";
    public static final String BANK_IMPORT_APPLY_ITEMS_COMMAND = "weeklyExpense.bankStatement.applyItems";
    public static final String UPSERT_PROJECTION_COMMAND = "weeklyExpense.projection.upsert";
    public static final String SUBMIT_WEEK_COMMAND = "weeklyExpense.submitWeek";
    public static final String CLOSE_WEEK_COMMAND = "weeklyExpense.closeWeek";
    public static final String WEEKLY_STATUS_READ_COMMAND = "weeklyExpense.status.read";
    public static final String CELL_PATCH_COMMAND = "weeklyExpense.cell.patch";
    public static final String CELLS_COPY_COMMAND = "weeklyExpense.cells.copy";
    public static final String CELLS_PASTE_COMMAND = "weeklyExpense.cells.paste";
    public static final String CELLS_CUT_COMMAND = "weeklyExpense.cells.cut";
    public static final String ROW_INSERT_COMMAND = "weeklyExpense.row.insert";
    public static final String ROW_DELETE_COMMAND = "weeklyExpense.row.delete";
    public static final String CASHFLOW_READ_COMMAND = "weeklyExpense.cashflow.read";
    public static final String AUDIT_EXPORT_CREATE_COMMAND = "weeklyExpense.auditExport.create";

    private static final Pattern WEEK_LABEL_PATTERN = Pattern.compile("(20\\d{2}-\\d{2}).*?([1-6])");
    private static final int ROW_REINDEX_TEMPORARY_OFFSET = 1_000_000;

    private final WeeklyExpensePersistence persistence;
    private final WeeklyExpenseAuthorizationService authorizationService;
    private final WeeklyExpenseSpreadsheetService spreadsheetService;
    private final ObjectMapper objectMapper;

    public WeeklyExpenseCommandService(
        WeeklyExpensePersistence persistence,
        WeeklyExpenseAuthorizationService authorizationService,
        ObjectMapper objectMapper
    ) {
        this.persistence = persistence;
        this.authorizationService = authorizationService;
        this.objectMapper = objectMapper;
        this.spreadsheetService = new WeeklyExpenseSpreadsheetService(new dev.merryai.innerplatform.weekly.domain.WeeklyExpenseCellValidator());
    }

    public void requireAllowed(String commandName, TrustedActorContext actor) {
        authorizationService.requireAllowed(commandName, actor);
    }

    public void requireProjectAllowed(String commandName, TrustedActorContext actor, String projectId) {
        authorizationService.requireProjectAllowed(commandName, actor, projectId);
    }

    @Transactional(readOnly = true)
    public WeeklyExpenseSheetResponse readSheet(TrustedActorContext actor, String projectId, String sheetKey) {
        authorizationService.requireProjectAllowed(SHEET_READ_COMMAND, actor, projectId);
        Optional<WeeklyExpenseSheetEntity> found = persistence.findSheetForUpdate(actor.tenantId(), projectId, sheetKey);
        if (found.isEmpty()) {
            return new WeeklyExpenseSheetResponse(true, projectId, "", sheetKey, sheetKey, 0, List.of());
        }
        return toSheetResponse(projectId, found.get());
    }

    @Transactional(readOnly = true)
    public WeeklyExpenseSheetsResponse listSheets(TrustedActorContext actor, String projectId) {
        authorizationService.requireProjectAllowed(SHEET_READ_COMMAND, actor, projectId);
        List<WeeklyExpenseSheetResponse> sheets = persistence.findSheets(actor.tenantId(), projectId).stream()
            .map(sheet -> toSheetResponse(projectId, sheet))
            .toList();
        return new WeeklyExpenseSheetsResponse(true, projectId, sheets);
    }

    private WeeklyExpenseSheetResponse toSheetResponse(String projectId, WeeklyExpenseSheetEntity sheet) {
        return new WeeklyExpenseSheetResponse(
            true,
            projectId,
            text(sheet.getId()),
            sheet.getSheetKey(),
            sheet.getName(),
            sheet.getSheetVersion(),
            sheet.getRows().stream()
                .sorted((left, right) -> Integer.compare(left.getRowIndex(), right.getRowIndex()))
                .map(row -> new WeeklyExpenseSheetResponse.Row(
                    text(row.getId()),
                    row.getRowIndex(),
                    row.getRowVersion(),
                    text(row.getSourceTxId()),
                    text(row.getEntryKind()),
                    row.getCells().stream()
                        .sorted((left, right) -> Integer.compare(left.getColumnIndex(), right.getColumnIndex()))
                        .map(cell -> new WeeklyExpenseSheetResponse.Cell(
                            cell.getColumnIndex(),
                            text(cell.getRawValue()),
                            text(cell.getNormalizedValue()),
                            cell.getValueType().name(),
                            cell.getValidationStatus().name(),
                            text(cell.getValidationMessage()),
                            cell.isUserEdited()
                        ))
                        .toList()
                ))
                .toList()
        );
    }

    @Transactional
    public SaveDraftResponse saveDraft(TrustedActorContext actor, String projectId, String sheetKey, SaveDraftRequest request) {
        authorizationService.requireProjectAllowed(SAVE_DRAFT_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<SaveDraftResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            SAVE_DRAFT_COMMAND,
            request.idempotencyKey(),
            requestHash,
            SaveDraftResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseSheetEntity sheet = loadSheet(actor.tenantId(), projectId, sheetKey, request.sheetName(), request.expectedSheetVersion());
        sheet.setName(request.sheetName());
        replaceRows(sheet, request.rows());
        List<CellValidationIssue> issues = spreadsheetService.validateAndRecalculateRows(sheet);
        List<SaveDraftResponse.ActualDelta> actualDelta = persistActuals(sheet);
        WeeklyExpenseSheetEntity savedSheet = persistence.saveSheet(sheet);

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            actor.tenantId(),
            projectId,
            sheetKey,
            SAVE_DRAFT_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            request.idempotencyKey(),
            metadataJson(actor, savedSheet, issues, actualDelta)
        ));

        SaveDraftResponse response = new SaveDraftResponse(
            true,
            SAVE_DRAFT_COMMAND,
            projectId,
            savedSheet.getId(),
            savedSheet.getSheetKey(),
            savedSheet.getSheetVersion(),
            savedSheet.getRows().size(),
            countCells(savedSheet),
            touchedRows(request.rows()),
            issues,
            actualDelta,
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            actor.tenantId(),
            projectId,
            request.idempotencyKey(),
            SAVE_DRAFT_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    @Transactional(readOnly = true)
    public BankStatementImportLinesResponse listBankStatementImportLines(
        TrustedActorContext actor,
        String projectId,
        String status
    ) {
        authorizationService.requireProjectAllowed(BANK_IMPORT_LIST_LINES_COMMAND, actor, projectId);
        String normalizedStatus = normalizeImportLineStatus(status);
        List<WeeklyExpenseBankImportLineEntity> lines = persistence.findBankImportLines(actor.tenantId(), projectId, normalizedStatus);
        List<BankStatementImportLinesResponse.Line> responseLines = lines.stream()
            .map(line -> new BankStatementImportLinesResponse.Line(
                line.getId(),
                line.getBatch().getId(),
                line.getBatch().getUploadName(),
                line.getBatch().getStatus(),
                line.getBatch().getCreatedBy(),
                line.getBatch().getCreatedAt(),
                readStringList(line.getBatch().getColumnJson()),
                line.getLineIndex(),
                line.getSourceLineKey(),
                line.getTransactionDate(),
                line.getCounterparty(),
                line.getMemo(),
                line.getSignedAmount(),
                line.getBalanceAfter(),
                readStringList(line.getRawCellsJson()),
                line.getStatus(),
                line.getAppliedSheetKey(),
                line.getAppliedRowId(),
                line.getAppliedAt(),
                line.getAppliedBy()
            ))
            .toList();
        return new BankStatementImportLinesResponse(
            true,
            projectId,
            normalizedStatus == null ? "all" : normalizedStatus,
            responseLines
        );
    }

    @Transactional
    public ImportBankStatementBatchResponse importBankStatementBatch(
        TrustedActorContext actor,
        String projectId,
        ImportBankStatementBatchRequest request
    ) {
        authorizationService.requireProjectAllowed(BANK_IMPORT_BATCH_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<ImportBankStatementBatchResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            BANK_IMPORT_BATCH_COMMAND,
            request.idempotencyKey(),
            requestHash,
            ImportBankStatementBatchResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseBankImportBatchEntity batch = new WeeklyExpenseBankImportBatchEntity(
            actor.tenantId(),
            projectId,
            request.uploadName(),
            writeJson(request.columns()),
            actor.id()
        );

        Set<String> seenSourceLineKeys = new LinkedHashSet<>();
        List<ImportBankStatementBatchResponse.LineResult> duplicateLines = new ArrayList<>();
        for (ImportBankStatementBatchRequest.LinePatch line : request.lines()) {
            CanonicalBankImportLine canonicalLine = canonicalizeBankImportLine(request.columns(), line);
            if (!seenSourceLineKeys.add(canonicalLine.sourceLineKey())) {
                duplicateLines.add(new ImportBankStatementBatchResponse.LineResult(
                    null,
                    canonicalLine.lineIndex(),
                    canonicalLine.sourceLineKey(),
                    "duplicate",
                    canonicalLine.signedAmount(),
                    true
                ));
                continue;
            }
            var duplicate = persistence.findBankImportLineBySourceKey(
                actor.tenantId(),
                projectId,
                canonicalLine.sourceLineKey()
            );
            if (duplicate.isPresent()) {
                WeeklyExpenseBankImportLineEntity existingLine = duplicate.get();
                duplicateLines.add(new ImportBankStatementBatchResponse.LineResult(
                    existingLine.getId(),
                    existingLine.getLineIndex(),
                    existingLine.getSourceLineKey(),
                    existingLine.getStatus(),
                    existingLine.getSignedAmount(),
                    true
                ));
                continue;
            }
            batch.addLine(new WeeklyExpenseBankImportLineEntity(
                batch,
                canonicalLine.lineIndex(),
                canonicalLine.sourceLineKey(),
                canonicalLine.transactionDate(),
                canonicalLine.counterparty(),
                canonicalLine.memo(),
                canonicalLine.signedAmount(),
                canonicalLine.balanceAfter(),
                writeJson(canonicalLine.rawCells())
            ));
        }

        WeeklyExpenseBankImportBatchEntity savedBatch = persistence.saveBankImportBatch(batch);
        List<ImportBankStatementBatchResponse.LineResult> lineResults = new ArrayList<>();
        for (WeeklyExpenseBankImportLineEntity line : savedBatch.getLines()) {
            lineResults.add(new ImportBankStatementBatchResponse.LineResult(
                line.getId(),
                line.getLineIndex(),
                line.getSourceLineKey(),
                line.getStatus(),
                line.getSignedAmount(),
                false
            ));
        }
        lineResults.addAll(duplicateLines);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("batchId", savedBatch.getId());
        metadata.put("stagedLineCount", savedBatch.getLines().size());
        metadata.put("duplicateLineCount", duplicateLines.size());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            actor.tenantId(),
            projectId,
            "bank-import",
            BANK_IMPORT_BATCH_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            request.idempotencyKey(),
            writeJson(metadata)
        ));

        ImportBankStatementBatchResponse response = new ImportBankStatementBatchResponse(
            true,
            BANK_IMPORT_BATCH_COMMAND,
            projectId,
            savedBatch.getId(),
            savedBatch.getLines().size(),
            duplicateLines.size(),
            lineResults,
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            actor.tenantId(),
            projectId,
            request.idempotencyKey(),
            BANK_IMPORT_BATCH_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    @Transactional
    public ApplyBankStatementItemsResponse applyBankStatementItems(
        TrustedActorContext actor,
        String projectId,
        ApplyBankStatementItemsRequest request
    ) {
        authorizationService.requireProjectAllowed(BANK_IMPORT_APPLY_ITEMS_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<ApplyBankStatementItemsResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            BANK_IMPORT_APPLY_ITEMS_COMMAND,
            request.idempotencyKey(),
            requestHash,
            ApplyBankStatementItemsResponse.class
        );
        if (replay.isPresent()) return replay.get();

        List<String> requestedLineIds = request.items().stream()
            .map(ApplyBankStatementItemsRequest.ItemPatch::importLineId)
            .distinct()
            .toList();
        if (requestedLineIds.size() != request.items().size()) {
            throw new IllegalArgumentException("Bank import line cannot be applied more than once in the same request.");
        }
        if (requestedLineIds.isEmpty()) {
            throw new IllegalArgumentException("At least one bank import line must be selected.");
        }
        List<WeeklyExpenseBankImportLineEntity> lockedLines = persistence
            .findBankImportLinesForUpdate(actor.tenantId(), projectId, requestedLineIds);
        if (lockedLines.size() != requestedLineIds.size()) {
            throw new WeeklyExpenseConflictException("Selected bank import lines changed. Reload and retry.");
        }
        Map<String, WeeklyExpenseBankImportLineEntity> linesById = new LinkedHashMap<>();
        for (WeeklyExpenseBankImportLineEntity line : lockedLines) {
            if (line.isApplied()) {
                throw new WeeklyExpenseConflictException("Bank import line is already applied: " + line.getId());
            }
            linesById.put(line.getId(), line);
        }

        WeeklyExpenseSheetEntity sheet = loadSheet(
            actor.tenantId(),
            projectId,
            request.sheetKey(),
            request.sheetName(),
            request.expectedSheetVersion()
        );
        int nextRowIndex = sheet.getRows().stream()
            .mapToInt(WeeklyExpenseRowEntity::getRowIndex)
            .max()
            .orElse(-1) + 1;
        Set<Integer> touchedRows = new LinkedHashSet<>();
        Map<String, WeeklyExpenseRowEntity> rowsByLineId = new LinkedHashMap<>();

        for (ApplyBankStatementItemsRequest.ItemPatch item : request.items()) {
            WeeklyExpenseBankImportLineEntity line = linesById.get(item.importLineId());
            if (line == null) {
                throw new WeeklyExpenseConflictException("Selected bank import line is unavailable: " + item.importLineId());
            }
            WeeklyExpenseRowEntity row = sheet.rowAt(nextRowIndex);
            nextRowIndex += 1;
            row.setSourceTxId("bank-import-line:" + line.getId());
            row.setEntryKind("bank_import");
            setRawCell(row, WeeklyExpenseColumn.DATE, line.getTransactionDate(), false);
            setRawCell(row, WeeklyExpenseColumn.BALANCE_AFTER, moneyText(line.getBalanceAfter()), false);
            setRawCell(row, WeeklyExpenseColumn.BANK_AMOUNT, moneyText(line.getSignedAmount()), false);
            if (line.getSignedAmount().signum() < 0) {
                setRawCell(row, WeeklyExpenseColumn.EXPENSE_AMOUNT, moneyText(line.getSignedAmount().abs()), false);
            } else {
                setRawCell(row, WeeklyExpenseColumn.DEPOSIT_AMOUNT, moneyText(line.getSignedAmount()), false);
            }
            setRawCell(row, WeeklyExpenseColumn.COUNTERPARTY, line.getCounterparty(), false);
            setRawCell(row, WeeklyExpenseColumn.MEMO, line.getMemo(), false);

            for (ApplyBankStatementItemsRequest.CellPatch patch : item.cells()) {
                requireColumnIndex(patch.columnIndex());
                WeeklyExpenseCellEntity cell = row.cellAt(patch.columnIndex());
                cell.setRawValue(patch.rawValue());
                cell.setUserEdited(Boolean.TRUE.equals(patch.userEdited()));
            }
            touchedRows.add(row.getRowIndex());
            rowsByLineId.put(line.getId(), row);
        }

        List<CellValidationIssue> issues = spreadsheetService.validateAndRecalculateRows(sheet);
        List<SaveDraftResponse.ActualDelta> actualDelta = persistActuals(sheet);
        WeeklyExpenseSheetEntity savedSheet = persistence.saveSheet(sheet);
        for (WeeklyExpenseBankImportLineEntity line : lockedLines) {
            WeeklyExpenseRowEntity row = rowsByLineId.get(line.getId());
            line.markApplied(savedSheet.getSheetKey(), row == null ? null : row.getId(), actor.id());
        }
        persistence.saveBankImportLines(lockedLines);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("sheetId", savedSheet.getId());
        metadata.put("sheetKey", savedSheet.getSheetKey());
        metadata.put("sheetVersion", savedSheet.getSheetVersion());
        metadata.put("appliedLineCount", lockedLines.size());
        metadata.put("touchedRows", touchedRows);
        metadata.put("validationIssueCount", issues.size());
        metadata.put("actualDeltaCount", actualDelta.size());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            actor.tenantId(),
            projectId,
            savedSheet.getSheetKey(),
            BANK_IMPORT_APPLY_ITEMS_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            request.idempotencyKey(),
            writeJson(metadata)
        ));

        ApplyBankStatementItemsResponse response = new ApplyBankStatementItemsResponse(
            true,
            BANK_IMPORT_APPLY_ITEMS_COMMAND,
            projectId,
            savedSheet.getId(),
            savedSheet.getSheetKey(),
            savedSheet.getSheetVersion(),
            lockedLines.size(),
            touchedRows,
            issues,
            actualDelta,
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            actor.tenantId(),
            projectId,
            request.idempotencyKey(),
            BANK_IMPORT_APPLY_ITEMS_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    @Transactional
    public UpsertProjectionResponse upsertProjection(TrustedActorContext actor, String projectId, UpsertProjectionRequest request) {
        authorizationService.requireProjectAllowed(UPSERT_PROJECTION_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<UpsertProjectionResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            UPSERT_PROJECTION_COMMAND,
            request.idempotencyKey(),
            requestHash,
            UpsertProjectionResponse.class
        );
        if (replay.isPresent()) return replay.get();

        Map<String, ProjectionLineAccumulator> projectionPatches = new LinkedHashMap<>();
        for (UpsertProjectionRequest.ProjectionLinePatch line : request.lines()) {
            String cashflowLine = CashflowLineCatalog.canonicalize(line.cashflowLine());
            String key = line.yearMonth() + ":" + line.weekNo() + ":" + cashflowLine;
            ProjectionLineAccumulator accumulator = projectionPatches.get(key);
            BigDecimal amount = line.amount() == null ? BigDecimal.ZERO : line.amount();
            if (accumulator == null) {
                projectionPatches.put(key, new ProjectionLineAccumulator(line.yearMonth(), line.weekNo(), cashflowLine, amount));
            } else {
                accumulator.add(amount);
            }
        }

        List<CashflowSnapshotResponse.ProjectionLine> projection = new ArrayList<>();
        for (ProjectionLineAccumulator line : projectionPatches.values()) {
            WeeklyExpenseProjectionEntity projectionEntity = persistence
                .findProjectionLine(
                    actor.tenantId(),
                    projectId,
                    line.yearMonth,
                    line.weekNo,
                    line.cashflowLine
                )
                .orElseGet(() -> new WeeklyExpenseProjectionEntity(
                    actor.tenantId(),
                    projectId,
                    line.yearMonth,
                    line.weekNo,
                    line.cashflowLine
                ));
            projectionEntity.setAmount(line.amount);
            WeeklyExpenseProjectionEntity saved = persistence.saveProjection(projectionEntity);
            projection.add(new CashflowSnapshotResponse.ProjectionLine(
                saved.getYearMonth(),
                saved.getWeekNo(),
                saved.getCashflowLine(),
                saved.getAmount()
            ));
        }

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            actor.tenantId(),
            projectId,
            "projection",
            UPSERT_PROJECTION_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            request.idempotencyKey(),
            projectionMetadataJson(actor, projection.size())
        ));

        UpsertProjectionResponse response = new UpsertProjectionResponse(
            true,
            UPSERT_PROJECTION_COMMAND,
            projectId,
            projection.size(),
            projection,
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            actor.tenantId(),
            projectId,
            request.idempotencyKey(),
            UPSERT_PROJECTION_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    @Transactional
    public SubmitWeekResponse submitWeek(TrustedActorContext actor, String projectId, SubmitWeekRequest request) {
        authorizationService.requireProjectAllowed(SUBMIT_WEEK_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<SubmitWeekResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            SUBMIT_WEEK_COMMAND,
            request.idempotencyKey(),
            requestHash,
            SubmitWeekResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseWeeklyStatusEntity status = persistence
            .findWeeklyStatus(
                actor.tenantId(),
                projectId,
                request.yearMonth(),
                request.weekNo()
            )
            .orElseGet(() -> new WeeklyExpenseWeeklyStatusEntity(
                actor.tenantId(),
                projectId,
                request.yearMonth(),
                request.weekNo()
            ));
        try {
            status.submit(actor.id());
        } catch (IllegalStateException error) {
            throw new WeeklyExpenseConflictException(error.getMessage());
        }
        WeeklyExpenseWeeklyStatusEntity saved = persistence.saveWeeklyStatus(status);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("yearMonth", request.yearMonth());
        metadata.put("weekNo", request.weekNo());
        metadata.put("state", saved.getState());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            actor.tenantId(),
            projectId,
            "weekly-status",
            SUBMIT_WEEK_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            request.idempotencyKey(),
            writeJson(metadata)
        ));

        SubmitWeekResponse response = new SubmitWeekResponse(
            true,
            SUBMIT_WEEK_COMMAND,
            projectId,
            saved.getYearMonth(),
            saved.getWeekNo(),
            saved.getState(),
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            actor.tenantId(),
            projectId,
            request.idempotencyKey(),
            SUBMIT_WEEK_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    @Transactional
    public CloseWeekResponse closeWeek(TrustedActorContext actor, String projectId, CloseWeekRequest request) {
        authorizationService.requireProjectAllowed(CLOSE_WEEK_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<CloseWeekResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            CLOSE_WEEK_COMMAND,
            request.idempotencyKey(),
            requestHash,
            CloseWeekResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseWeeklyStatusEntity status = persistence
            .findWeeklyStatus(
                actor.tenantId(),
                projectId,
                request.yearMonth(),
                request.weekNo()
            )
            .orElseThrow(() -> new WeeklyExpenseConflictException("Week must be submitted before close."));
        try {
            status.close(actor.id());
        } catch (IllegalStateException error) {
            throw new WeeklyExpenseConflictException(error.getMessage());
        }
        WeeklyExpenseWeeklyStatusEntity saved = persistence.saveWeeklyStatus(status);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("yearMonth", request.yearMonth());
        metadata.put("weekNo", request.weekNo());
        metadata.put("state", saved.getState());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            actor.tenantId(),
            projectId,
            "weekly-status",
            CLOSE_WEEK_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            request.idempotencyKey(),
            writeJson(metadata)
        ));

        CloseWeekResponse response = new CloseWeekResponse(
            true,
            CLOSE_WEEK_COMMAND,
            projectId,
            saved.getYearMonth(),
            saved.getWeekNo(),
            saved.getState(),
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            actor.tenantId(),
            projectId,
            request.idempotencyKey(),
            CLOSE_WEEK_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    @Transactional
    public CreateAuditExportResponse createAuditExport(
        TrustedActorContext actor,
        String projectId,
        CreateAuditExportRequest request
    ) {
        authorizationService.requireProjectAllowed(AUDIT_EXPORT_CREATE_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<CreateAuditExportResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            AUDIT_EXPORT_CREATE_COMMAND,
            request.idempotencyKey(),
            requestHash,
            CreateAuditExportResponse.class
        );
        if (replay.isPresent()) return replay.get();

        String artifactType = normalizeExportFormat(request.format());
        List<WeeklyExpenseProjectionEntity> projection = persistence.findProjectionLinesForAudit(actor.tenantId(), projectId);
        List<WeeklyExpenseActualEntity> actual = persistence.findActualLinesForAudit(actor.tenantId(), projectId);
        List<WeeklyExpenseAuditEventEntity> auditEvents = Boolean.FALSE.equals(request.includeAuditSummary())
            ? List.of()
            : persistence.findAuditEventsForAudit(actor.tenantId(), projectId);

        String content = buildAuditExportCsv(projectId, projection, actual, auditEvents);
        String digest = sha256(content);
        String fileName = sanitizeFileName(projectId) + "-weekly-expense-audit.csv";
        WeeklyExpenseAuditExportEntity artifact = persistence.saveAuditExport(new WeeklyExpenseAuditExportEntity(
            actor.tenantId(),
            projectId,
            artifactType,
            fileName,
            digest,
            content,
            projection.size(),
            actual.size(),
            auditEvents.size(),
            actor.id()
        ));

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("artifactId", artifact.getId());
        metadata.put("artifactType", artifact.getArtifactType());
        metadata.put("fileName", artifact.getArtifactFileName());
        metadata.put("sha256", artifact.getArtifactSha256());
        metadata.put("projectionLineCount", artifact.getProjectionLineCount());
        metadata.put("actualLineCount", artifact.getActualLineCount());
        metadata.put("auditEventCount", artifact.getAuditEventCount());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            actor.tenantId(),
            projectId,
            "audit-export",
            AUDIT_EXPORT_CREATE_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            request.idempotencyKey(),
            writeJson(metadata)
        ));

        CreateAuditExportResponse response = new CreateAuditExportResponse(
            true,
            AUDIT_EXPORT_CREATE_COMMAND,
            projectId,
            artifact.getId(),
            artifact.getArtifactType(),
            artifact.getArtifactFileName(),
            artifact.getArtifactSha256(),
            artifact.getProjectionLineCount(),
            artifact.getActualLineCount(),
            artifact.getAuditEventCount(),
            artifact.getArtifactContent(),
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            actor.tenantId(),
            projectId,
            request.idempotencyKey(),
            AUDIT_EXPORT_CREATE_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    @Transactional
    public CellCommandResponse patchCells(TrustedActorContext actor, String projectId, String sheetKey, CellPatchCommandRequest request) {
        authorizationService.requireProjectAllowed(CELL_PATCH_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<CellCommandResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            CELL_PATCH_COMMAND,
            request.idempotencyKey(),
            requestHash,
            CellCommandResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseSheetEntity sheet = loadSheet(actor.tenantId(), projectId, sheetKey, request.sheetName(), request.expectedSheetVersion());
        Set<Integer> touchedRows = new LinkedHashSet<>();
        for (CellPatchCommandRequest.CellPatch patch : request.cells()) {
            requireCellCoordinate(patch.rowIndex(), patch.columnIndex());
            WeeklyExpenseRowEntity row = sheet.rowAt(patch.rowIndex());
            WeeklyExpenseCellEntity cell = row.cellAt(patch.columnIndex());
            cell.setRawValue(patch.rawValue());
            cell.setUserEdited(Boolean.TRUE.equals(patch.userEdited()));
            touchedRows.add(patch.rowIndex());
        }
        return finishCellCommand(
            CELL_PATCH_COMMAND,
            projectId,
            sheetKey,
            actor.tenantId(),
            actor,
            request.idempotencyKey(),
            requestHash,
            sheet,
            touchedRows,
            request.cells().size(),
            null
        );
    }

    @Transactional
    public CellCommandResponse copyCells(TrustedActorContext actor, String projectId, String sheetKey, CopyCellsRequest request) {
        authorizationService.requireProjectAllowed(CELLS_COPY_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<CellCommandResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            CELLS_COPY_COMMAND,
            request.idempotencyKey(),
            requestHash,
            CellCommandResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseSheetEntity sheet = loadExistingSheet(actor.tenantId(), projectId, sheetKey, request.expectedSheetVersion());
        requireSelectionBounds(request.startRow(), request.startColumn(), request.endRow(), request.endColumn());
        SpreadsheetSelection selection = new SpreadsheetSelection(
            request.startRow(),
            request.startColumn(),
            request.endRow(),
            request.endColumn()
        );
        ClipboardPayload clipboard = spreadsheetService.copy(sheet, selection, request.depth());
        Set<Integer> touchedRows = new LinkedHashSet<>();
        for (int rowIndex = selection.top(); rowIndex <= selection.bottom(); rowIndex += 1) {
            touchedRows.add(rowIndex);
        }
        return finishCopyCommand(
            projectId,
            sheetKey,
            actor.tenantId(),
            actor,
            request.idempotencyKey(),
            requestHash,
            sheet,
            touchedRows,
            clipboard
        );
    }

    @Transactional
    public CellCommandResponse pasteCells(TrustedActorContext actor, String projectId, String sheetKey, PasteCellsRequest request) {
        authorizationService.requireProjectAllowed(CELLS_PASTE_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<CellCommandResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            CELLS_PASTE_COMMAND,
            request.idempotencyKey(),
            requestHash,
            CellCommandResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseSheetEntity sheet = loadSheet(actor.tenantId(), projectId, sheetKey, request.sheetName(), request.expectedSheetVersion());
        requirePasteRectangle(request);
        ClipboardPayload payload = new ClipboardPayload(
            SpreadsheetOperationType.COPY,
            request.depth(),
            new SpreadsheetSelection(0, 0, request.rowCount() - 1, request.columnCount() - 1),
            request.rowCount(),
            request.columnCount(),
            request.cells().stream()
                .map(cell -> new ClipboardCell(
                    cell.relativeRow(),
                    cell.relativeColumn(),
                    cell.rawValue(),
                    cell.normalizedValue() == null ? cell.rawValue() : cell.normalizedValue(),
                    cell.valueType() == null ? SpreadsheetValueType.TEXT : cell.valueType(),
                    cell.validationStatus() == null ? CellValidationStatus.UNKNOWN : cell.validationStatus(),
                    cell.validationMessage() == null ? "" : cell.validationMessage()
                ))
                .toList()
        );
        PasteResult result = spreadsheetService.paste(sheet, new CellAddress(request.anchorRow(), request.anchorColumn()), payload);
        return finishCellCommand(
            CELLS_PASTE_COMMAND,
            projectId,
            sheetKey,
            actor.tenantId(),
            actor,
            request.idempotencyKey(),
            requestHash,
            sheet,
            result.touchedRows(),
            result.touchedCellCount(),
            null
        );
    }

    @Transactional
    public CellCommandResponse cutCells(TrustedActorContext actor, String projectId, String sheetKey, CutCellsRequest request) {
        authorizationService.requireProjectAllowed(CELLS_CUT_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<CellCommandResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            CELLS_CUT_COMMAND,
            request.idempotencyKey(),
            requestHash,
            CellCommandResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseSheetEntity sheet = loadSheet(actor.tenantId(), projectId, sheetKey, null, request.expectedSheetVersion());
        requireSelectionBounds(request.startRow(), request.startColumn(), request.endRow(), request.endColumn());
        SpreadsheetSelection selection = new SpreadsheetSelection(
            request.startRow(),
            request.startColumn(),
            request.endRow(),
            request.endColumn()
        );
        ClipboardPayload clipboard = spreadsheetService.cut(sheet, selection, request.depth());
        Set<Integer> touchedRows = new LinkedHashSet<>();
        for (int rowIndex = selection.top(); rowIndex <= selection.bottom(); rowIndex += 1) {
            touchedRows.add(rowIndex);
        }
        return finishCellCommand(
            CELLS_CUT_COMMAND,
            projectId,
            sheetKey,
            actor.tenantId(),
            actor,
            request.idempotencyKey(),
            requestHash,
            sheet,
            touchedRows,
            clipboard.cells().size(),
            clipboard
        );
    }

    @Transactional
    public RowCommandResponse insertRows(TrustedActorContext actor, String projectId, String sheetKey, RowInsertRequest request) {
        authorizationService.requireProjectAllowed(ROW_INSERT_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<RowCommandResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            ROW_INSERT_COMMAND,
            request.idempotencyKey(),
            requestHash,
            RowCommandResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseSheetEntity sheet = loadSheet(actor.tenantId(), projectId, sheetKey, request.sheetName(), request.expectedSheetVersion());
        requireRowSpan(request.startRow(), request.rowCount());
        requireInsertDoesNotOverflowExistingRows(sheet, request.startRow(), request.rowCount());
        if (sheet.getRows().size() + request.rowCount() > WeeklyExpenseRequestLimits.MAX_ROW_COUNT) {
            throw new IllegalArgumentException("Row insert would exceed weekly expense sheet row limit.");
        }
        sheet.moveRowsToTemporaryIndexesFrom(request.startRow(), ROW_REINDEX_TEMPORARY_OFFSET);
        persistence.flushSheet(sheet);
        Set<Integer> touchedRows = new LinkedHashSet<>(sheet.finishInsertRowsFromTemporaryIndexes(
            request.startRow(),
            request.rowCount(),
            ROW_REINDEX_TEMPORARY_OFFSET
        ));
        return finishRowCommand(
            ROW_INSERT_COMMAND,
            projectId,
            sheetKey,
            actor.tenantId(),
            actor,
            request.idempotencyKey(),
            requestHash,
            sheet,
            touchedRows,
            request.rowCount()
        );
    }

    @Transactional
    public RowCommandResponse deleteRows(TrustedActorContext actor, String projectId, String sheetKey, RowDeleteRequest request) {
        authorizationService.requireProjectAllowed(ROW_DELETE_COMMAND, actor, projectId);
        String requestHash = hashJson(request);
        Optional<RowCommandResponse> replay = readIdempotentResponse(
            actor.tenantId(),
            projectId,
            ROW_DELETE_COMMAND,
            request.idempotencyKey(),
            requestHash,
            RowCommandResponse.class
        );
        if (replay.isPresent()) return replay.get();

        WeeklyExpenseSheetEntity sheet = loadSheet(actor.tenantId(), projectId, sheetKey, null, request.expectedSheetVersion());
        requireRowSpan(request.startRow(), request.rowCount());
        requireExpectedRowVersions(sheet, request.expectedRowVersions());
        sheet.moveRowsToTemporaryIndexesFrom(request.startRow(), ROW_REINDEX_TEMPORARY_OFFSET);
        persistence.flushSheet(sheet);
        Set<Integer> touchedRows = new LinkedHashSet<>(sheet.finishDeleteRowsFromTemporaryIndexes(
            request.startRow(),
            request.rowCount(),
            ROW_REINDEX_TEMPORARY_OFFSET
        ));
        return finishRowCommand(
            ROW_DELETE_COMMAND,
            projectId,
            sheetKey,
            actor.tenantId(),
            actor,
            request.idempotencyKey(),
            requestHash,
            sheet,
            touchedRows,
            request.rowCount()
        );
    }

    private WeeklyExpenseSheetEntity loadSheet(
        String tenantId,
        String projectId,
        String sheetKey,
        String sheetName,
        Long expectedSheetVersion
    ) {
        Optional<WeeklyExpenseSheetEntity> existing = persistence.findSheetForUpdate(tenantId, projectId, sheetKey);
        if (existing.isEmpty()) {
            return new WeeklyExpenseSheetEntity(tenantId, projectId, sheetKey, sheetName);
        }
        WeeklyExpenseSheetEntity sheet = existing.get();
        if (expectedSheetVersion == null) {
            throw new WeeklyExpenseConflictException("Existing sheet mutations require expectedSheetVersion.");
        }
        if (sheet.getSheetVersion() != expectedSheetVersion) {
            throw new WeeklyExpenseConflictException("Sheet version mismatch. Reload the sheet before applying this command.");
        }
        if (sheetName != null) {
            sheet.setName(sheetName);
        }
        return sheet;
    }

    private WeeklyExpenseSheetEntity loadExistingSheet(
        String tenantId,
        String projectId,
        String sheetKey,
        Long expectedSheetVersion
    ) {
        WeeklyExpenseSheetEntity sheet = persistence
            .findSheetForUpdate(tenantId, projectId, sheetKey)
            .orElseThrow(() -> new WeeklyExpenseConflictException("Cannot copy from a sheet that does not exist."));
        if (expectedSheetVersion == null) {
            throw new WeeklyExpenseConflictException("Existing sheet copy requires expectedSheetVersion.");
        }
        if (sheet.getSheetVersion() != expectedSheetVersion) {
            throw new WeeklyExpenseConflictException("Sheet version mismatch. Reload the sheet before applying this command.");
        }
        return sheet;
    }

    private CellCommandResponse finishCopyCommand(
        String projectId,
        String sheetKey,
        String tenantId,
        TrustedActorContext actor,
        String idempotencyKey,
        String requestHash,
        WeeklyExpenseSheetEntity sheet,
        Set<Integer> touchedRows,
        ClipboardPayload clipboard
    ) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("sheetId", sheet.getId());
        metadata.put("sheetKey", sheet.getSheetKey());
        metadata.put("sheetVersion", sheet.getSheetVersion());
        metadata.put("sourceSelection", clipboard.sourceSelection());
        metadata.put("touchedRows", touchedRows);
        metadata.put("touchedCellCount", clipboard.cells().size());
        metadata.put("depth", clipboard.depth());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            tenantId,
            projectId,
            sheetKey,
            CELLS_COPY_COMMAND,
            actor.id(),
            normalizeRole(actor.role()),
            idempotencyKey,
            writeJson(metadata)
        ));

        CellCommandResponse response = new CellCommandResponse(
            true,
            CELLS_COPY_COMMAND,
            projectId,
            sheet.getId(),
            sheet.getSheetKey(),
            sheet.getSheetVersion(),
            touchedRows,
            clipboard.cells().size(),
            List.of(),
            List.of(),
            clipboard,
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            tenantId,
            projectId,
            idempotencyKey,
            CELLS_COPY_COMMAND,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    private CellCommandResponse finishCellCommand(
        String commandName,
        String projectId,
        String sheetKey,
        String tenantId,
        TrustedActorContext actor,
        String idempotencyKey,
        String requestHash,
        WeeklyExpenseSheetEntity sheet,
        Set<Integer> touchedRows,
        int touchedCellCount,
        ClipboardPayload clipboard
    ) {
        List<CellValidationIssue> issues = spreadsheetService.validateAndRecalculateRows(sheet);
        List<SaveDraftResponse.ActualDelta> actualDelta = persistActuals(sheet);
        WeeklyExpenseSheetEntity savedSheet = persistence.saveSheet(sheet);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("sheetId", savedSheet.getId());
        metadata.put("sheetKey", savedSheet.getSheetKey());
        metadata.put("sheetVersion", savedSheet.getSheetVersion());
        metadata.put("touchedRows", touchedRows);
        metadata.put("touchedCellCount", touchedCellCount);
        metadata.put("validationIssueCount", issues.size());
        metadata.put("actualDeltaCount", actualDelta.size());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            tenantId,
            projectId,
            sheetKey,
            commandName,
            actor.id(),
            normalizeRole(actor.role()),
            idempotencyKey,
            writeJson(metadata)
        ));

        CellCommandResponse response = new CellCommandResponse(
            true,
            commandName,
            projectId,
            savedSheet.getId(),
            savedSheet.getSheetKey(),
            savedSheet.getSheetVersion(),
            touchedRows,
            touchedCellCount,
            issues,
            actualDelta,
            clipboard,
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            tenantId,
            projectId,
            idempotencyKey,
            commandName,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    private RowCommandResponse finishRowCommand(
        String commandName,
        String projectId,
        String sheetKey,
        String tenantId,
        TrustedActorContext actor,
        String idempotencyKey,
        String requestHash,
        WeeklyExpenseSheetEntity sheet,
        Set<Integer> touchedRows,
        int affectedRowCount
    ) {
        List<CellValidationIssue> issues = spreadsheetService.validateAndRecalculateRows(sheet);
        List<SaveDraftResponse.ActualDelta> actualDelta = persistActuals(sheet);
        WeeklyExpenseSheetEntity savedSheet = persistence.saveSheet(sheet);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("sheetId", savedSheet.getId());
        metadata.put("sheetKey", savedSheet.getSheetKey());
        metadata.put("sheetVersion", savedSheet.getSheetVersion());
        metadata.put("touchedRows", touchedRows);
        metadata.put("affectedRowCount", affectedRowCount);
        metadata.put("validationIssueCount", issues.size());
        metadata.put("actualDeltaCount", actualDelta.size());

        WeeklyExpenseAuditEventEntity auditEvent = persistence.saveAuditEvent(new WeeklyExpenseAuditEventEntity(
            tenantId,
            projectId,
            sheetKey,
            commandName,
            actor.id(),
            normalizeRole(actor.role()),
            idempotencyKey,
            writeJson(metadata)
        ));

        RowCommandResponse response = new RowCommandResponse(
            true,
            commandName,
            projectId,
            savedSheet.getId(),
            savedSheet.getSheetKey(),
            savedSheet.getSheetVersion(),
            touchedRows,
            rowVersionsFor(savedSheet, touchedRows),
            affectedRowCount,
            issues,
            actualDelta,
            auditEvent.getId()
        );
        persistence.saveIdempotency(new WeeklyExpenseIdempotencyEntity(
            tenantId,
            projectId,
            idempotencyKey,
            commandName,
            requestHash,
            writeJson(response)
        ));
        return response;
    }

    private List<RowCommandResponse.RowVersion> rowVersionsFor(
        WeeklyExpenseSheetEntity sheet,
        Set<Integer> rowIndexes
    ) {
        List<RowCommandResponse.RowVersion> rowVersions = new ArrayList<>();
        for (Integer rowIndex : rowIndexes) {
            if (rowIndex == null) continue;
            sheet.findRow(rowIndex)
                .map(row -> new RowCommandResponse.RowVersion(row.getRowIndex(), row.getRowVersion()))
                .ifPresent(rowVersions::add);
        }
        rowVersions.sort(Comparator.comparingInt(RowCommandResponse.RowVersion::rowIndex));
        return rowVersions;
    }

    private void requirePasteRectangle(PasteCellsRequest request) {
        requireRowSpan(request.anchorRow(), request.rowCount());
        requireColumnSpan(request.anchorColumn(), request.columnCount());
        long expectedCellCount = (long) request.rowCount() * request.columnCount();
        if (expectedCellCount != request.cells().size()) {
            throw new IllegalArgumentException("Paste cells must exactly match rowCount * columnCount.");
        }
        Set<String> positions = new LinkedHashSet<>();
        for (PasteCellsRequest.PasteCell cell : request.cells()) {
            if (cell.relativeRow() >= request.rowCount() || cell.relativeColumn() >= request.columnCount()) {
                throw new IllegalArgumentException("Paste cell coordinate is outside the declared rectangle.");
            }
            String key = cell.relativeRow() + ":" + cell.relativeColumn();
            if (!positions.add(key)) {
                throw new IllegalArgumentException("Paste rectangle contains duplicate cell coordinates.");
            }
        }
    }

    private void requireInsertDoesNotOverflowExistingRows(WeeklyExpenseSheetEntity sheet, int startRow, int rowCount) {
        for (WeeklyExpenseRowEntity row : sheet.getRows()) {
            if (row.getRowIndex() >= startRow && row.getRowIndex() + rowCount > WeeklyExpenseRequestLimits.MAX_ROW_INDEX) {
                throw new IllegalArgumentException("Row insert would move existing rows beyond the weekly expense sheet row limit.");
            }
        }
    }

    private void requireSelectionBounds(int startRow, int startColumn, int endRow, int endColumn) {
        int top = Math.min(startRow, endRow);
        int bottom = Math.max(startRow, endRow);
        int left = Math.min(startColumn, endColumn);
        int right = Math.max(startColumn, endColumn);
        requireRowSpan(top, bottom - top + 1);
        requireColumnSpan(left, right - left + 1);
    }

    private void requireCellCoordinate(int rowIndex, int columnIndex) {
        requireRowIndex(rowIndex);
        requireColumnIndex(columnIndex);
    }

    private void requireRowSpan(int startRow, int rowCount) {
        requireRowIndex(startRow);
        if (rowCount <= 0 || (long) startRow + rowCount > WeeklyExpenseRequestLimits.MAX_ROW_COUNT) {
            throw new IllegalArgumentException("Row range exceeds weekly expense sheet row limit.");
        }
    }

    private void requireColumnSpan(int startColumn, int columnCount) {
        requireColumnIndex(startColumn);
        if (columnCount <= 0 || startColumn + columnCount > WeeklyExpenseRequestLimits.COLUMN_COUNT) {
            throw new IllegalArgumentException("Column range exceeds weekly expense sheet schema.");
        }
    }

    private void requireRowIndex(int rowIndex) {
        if (rowIndex < 0 || rowIndex > WeeklyExpenseRequestLimits.MAX_ROW_INDEX) {
            throw new IllegalArgumentException("rowIndex exceeds weekly expense sheet row limit.");
        }
    }

    private void requireColumnIndex(int columnIndex) {
        if (columnIndex < 0 || columnIndex > WeeklyExpenseRequestLimits.MAX_COLUMN_INDEX) {
            throw new IllegalArgumentException("columnIndex is outside the weekly expense sheet schema.");
        }
    }

    private void requireExpectedRowVersions(
        WeeklyExpenseSheetEntity sheet,
        List<RowDeleteRequest.ExpectedRowVersion> expectedRowVersions
    ) {
        if (expectedRowVersions == null || expectedRowVersions.isEmpty()) {
            throw new WeeklyExpenseConflictException("Deleting rows requires explicit row version checks.");
        }
        for (RowDeleteRequest.ExpectedRowVersion expected : expectedRowVersions) {
            WeeklyExpenseRowEntity row = sheet.findRow(expected.rowIndex())
                .orElseThrow(() -> new WeeklyExpenseConflictException("Expected row does not exist: " + expected.rowIndex()));
            if (row.getRowVersion() != expected.rowVersion()) {
                throw new WeeklyExpenseConflictException("Row version mismatch for row " + expected.rowIndex() + ".");
            }
        }
    }

    private void replaceRows(WeeklyExpenseSheetEntity sheet, List<SaveDraftRequest.RowPatch> rows) {
        requireUniqueRowPatchIdentities(rows);
        Map<Integer, ExistingRowIdentity> existingByIndex = new LinkedHashMap<>();
        Map<String, ExistingRowIdentity> existingById = new LinkedHashMap<>();
        Map<String, ExistingRowIdentity> existingBySourceTx = new LinkedHashMap<>();
        for (WeeklyExpenseRowEntity existing : sheet.getRows()) {
            ExistingRowIdentity identity = new ExistingRowIdentity(existing.getId(), existing.getRowVersion(), existing.getSourceTxId());
            existingByIndex.put(existing.getRowIndex(), identity);
            if (existing.getId() != null && !existing.getId().isBlank()) {
                existingById.put(existing.getId(), identity);
            }
            if (existing.getSourceTxId() != null && !existing.getSourceTxId().isBlank()) {
                existingBySourceTx.put(existing.getSourceTxId(), identity);
            }
        }
        sheet.getRows().clear();
        for (SaveDraftRequest.RowPatch rowPatch : rows) {
            WeeklyExpenseRowEntity row = sheet.rowAt(rowPatch.rowIndex());
            ExistingRowIdentity identity = resolveExistingRowIdentity(rowPatch, existingById, existingBySourceTx, existingByIndex);
            if (identity != null) {
                row.restorePersistenceState(identity.id(), identity.rowVersion());
            }
            row.setSourceTxId(rowPatch.sourceTxId());
            row.setEntryKind(rowPatch.entryKind());
            for (SaveDraftRequest.CellPatch cellPatch : rowPatch.cells()) {
                requireCellCoordinate(rowPatch.rowIndex(), cellPatch.columnIndex());
                WeeklyExpenseCellEntity cell = row.cellAt(cellPatch.columnIndex());
                cell.setRawValue(cellPatch.rawValue());
                cell.setUserEdited(Boolean.TRUE.equals(cellPatch.userEdited()));
            }
        }
    }

    private void requireUniqueRowPatchIdentities(List<SaveDraftRequest.RowPatch> rows) {
        Set<Integer> rowIndexes = new LinkedHashSet<>();
        Set<String> tempIds = new LinkedHashSet<>();
        Set<String> sourceTxIds = new LinkedHashSet<>();
        for (SaveDraftRequest.RowPatch row : rows) {
            if (!rowIndexes.add(row.rowIndex())) {
                throw new WeeklyExpenseConflictException("Duplicate row index in save draft request: " + row.rowIndex());
            }
            String tempId = normalizeOptionalIdentity(row.tempId());
            if (tempId != null && !tempIds.add(tempId)) {
                throw new WeeklyExpenseConflictException("Duplicate row tempId in save draft request.");
            }
            String sourceTxId = normalizeOptionalIdentity(row.sourceTxId());
            if (sourceTxId != null && !sourceTxIds.add(sourceTxId)) {
                throw new WeeklyExpenseConflictException("Duplicate source transaction in save draft request.");
            }
        }
    }

    private String normalizeOptionalIdentity(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        return normalized.isBlank() ? null : normalized;
    }

    private ExistingRowIdentity resolveExistingRowIdentity(
        SaveDraftRequest.RowPatch rowPatch,
        Map<String, ExistingRowIdentity> existingById,
        Map<String, ExistingRowIdentity> existingBySourceTx,
        Map<Integer, ExistingRowIdentity> existingByIndex
    ) {
        if (rowPatch.tempId() != null && !rowPatch.tempId().isBlank()) {
            ExistingRowIdentity byId = existingById.get(rowPatch.tempId());
            if (byId != null) return byId;
        }
        if (rowPatch.sourceTxId() != null && !rowPatch.sourceTxId().isBlank()) {
            ExistingRowIdentity bySourceTx = existingBySourceTx.get(rowPatch.sourceTxId());
            if (bySourceTx != null) return bySourceTx;
        }
        return existingByIndex.get(rowPatch.rowIndex());
    }

    private List<SaveDraftResponse.ActualDelta> persistActuals(WeeklyExpenseSheetEntity sheet) {
        Map<String, SaveDraftResponse.ActualDelta> deltas = new LinkedHashMap<>();
        for (WeeklyExpenseRowEntity row : sheet.getRows()) {
            if (row.getValidationErrorCount() > 0 || row.getReviewRequiredCount() > 0) {
                continue;
            }
            WeekKey week = parseWeek(row);
            String cashflowLine = CashflowLineCatalog.canonicalize(textAt(row, WeeklyExpenseColumn.CASHFLOW_LINE));
            if (week == null || cashflowLine.isBlank()) continue;
            BigDecimal amount = WeeklyExpenseFormulaEngine.evaluateRow(row).actualAmount();
            if (amount.signum() == 0) continue;
            String key = week.yearMonth + ":" + week.weekNo + ":" + cashflowLine;
            SaveDraftResponse.ActualDelta previous = deltas.get(key);
            BigDecimal nextAmount = previous == null ? amount : previous.amount().add(amount);
            deltas.put(key, new SaveDraftResponse.ActualDelta(week.yearMonth, week.weekNo, cashflowLine, nextAmount));
        }

        return persistence.replaceActuals(sheet, new ArrayList<>(deltas.values()));
    }

    private WeekKey parseWeek(WeeklyExpenseRowEntity row) {
        String label = textAt(row, WeeklyExpenseColumn.WEEK);
        Matcher matcher = WEEK_LABEL_PATTERN.matcher(label);
        if (!matcher.find()) return null;
        return new WeekKey(matcher.group(1), Integer.parseInt(matcher.group(2)));
    }

    private String textAt(WeeklyExpenseRowEntity row, WeeklyExpenseColumn column) {
        return row.findCell(column.index())
            .map(WeeklyExpenseCellEntity::getNormalizedValue)
            .filter(value -> !value.isBlank())
            .or(() -> row.findCell(column.index()).map(WeeklyExpenseCellEntity::getRawValue))
            .orElse("")
            .trim();
    }

    private void setRawCell(WeeklyExpenseRowEntity row, WeeklyExpenseColumn column, String rawValue, boolean userEdited) {
        WeeklyExpenseCellEntity cell = row.cellAt(column.index());
        cell.setRawValue(rawValue);
        cell.setUserEdited(userEdited);
    }

    private String moneyText(BigDecimal value) {
        if (value == null) return "0";
        return value.stripTrailingZeros().toPlainString();
    }

    private CanonicalBankImportLine canonicalizeBankImportLine(
        List<String> columns,
        ImportBankStatementBatchRequest.LinePatch line
    ) {
        List<String> safeColumns = columns == null ? List.of() : columns.stream().map(this::normalizeText).toList();
        List<String> sourceCells = line.rawCells() == null ? List.of() : line.rawCells();
        List<String> rawCells = new ArrayList<>();
        for (int i = 0; i < safeColumns.size(); i++) {
            rawCells.add(i < sourceCells.size() ? normalizeText(sourceCells.get(i)) : "");
        }
        int dateIndex = firstHeaderIndex(safeColumns, List.of("거래일자", "거래일시", "거래일", "일자", "날짜", "date"));
        String rawDate = dateIndex >= 0 ? rawCells.get(dateIndex) : rawCells.stream()
            .map(this::normalizeDateTimeToSecond)
            .filter(value -> !value.isBlank())
            .findFirst()
            .orElse("");
        String dateTime = normalizeDateTimeToSecond(rawDate);
        String counterparty = pickBankCounterparty(safeColumns, rawCells);
        BankImportAmount amount = pickBankAmount(safeColumns, rawCells);
        if (dateTime.isBlank() || counterparty.isBlank() || amount.signedAmount() == null) {
            throw new IllegalArgumentException("Bank import row requires transaction date, counterparty, and amount.");
        }
        BigDecimal signedAmount = amount.signedAmount();
        String sourceLineKey = "bank-" + sha256(dateTime + "|" + normalizeKey(counterparty) + "|" + moneyText(signedAmount));
        return new CanonicalBankImportLine(
            line.lineIndex(),
            sourceLineKey,
            dateTime.substring(0, Math.min(10, dateTime.length())),
            counterparty,
            pickBankMemo(safeColumns, rawCells),
            signedAmount,
            pickBankBalanceAfter(safeColumns, rawCells),
            rawCells
        );
    }

    private String normalizeDateTimeToSecond(String raw) {
        String value = normalizeText(raw).replace('.', '-').replace('T', ' ');
        if (value.isBlank()) return "";
        Matcher ymd = Pattern
            .compile("(\\d{4})\\D(\\d{1,2})\\D(\\d{1,2})(?:\\s+(\\d{1,2})(?::(\\d{1,2}))?(?::(\\d{1,2}))?)?")
            .matcher(value);
        if (ymd.find()) {
            String date = ymd.group(1) + "-" + twoDigits(ymd.group(2)) + "-" + twoDigits(ymd.group(3));
            if (ymd.group(4) == null) return date;
            return date + " " + twoDigits(ymd.group(4)) + ":" + twoDigits(defaultText(ymd.group(5), "0")) + ":" + twoDigits(defaultText(ymd.group(6), "0"));
        }
        Matcher mdy = Pattern
            .compile("(\\d{1,2})/(\\d{1,2})/(\\d{2}|\\d{4})(?:\\s+(\\d{1,2})(?::(\\d{1,2}))?(?::(\\d{1,2}))?)?")
            .matcher(value);
        if (mdy.find()) {
            int year = Integer.parseInt(mdy.group(3));
            if (year < 100) year += 2000;
            String date = year + "-" + twoDigits(mdy.group(1)) + "-" + twoDigits(mdy.group(2));
            if (mdy.group(4) == null) return date;
            return date + " " + twoDigits(mdy.group(4)) + ":" + twoDigits(defaultText(mdy.group(5), "0")) + ":" + twoDigits(defaultText(mdy.group(6), "0"));
        }
        return "";
    }

    private String pickBankCounterparty(List<String> columns, List<String> rawCells) {
        List<List<String>> groups = List.of(
            List.of("사용처", "가맹점", "상호", "거래처", "지급처"),
            List.of("의뢰인/수취인", "의뢰인수취인", "수취인", "의뢰인", "상대계좌명"),
            List.of("내용", "거래내용"),
            List.of("적요", "메모")
        );
        for (List<String> aliases : groups) {
            for (int idx : headerIndices(columns, aliases)) {
                String value = cell(rawCells, idx);
                if (!value.isBlank()) return value;
            }
        }
        return "";
    }

    private String pickBankMemo(List<String> columns, List<String> rawCells) {
        for (int idx : headerIndices(columns, List.of("적요", "메모", "내용", "거래내용", "상세적요"))) {
            String value = cell(rawCells, idx);
            if (!value.isBlank()) return value;
        }
        return "";
    }

    private BigDecimal pickBankBalanceAfter(List<String> columns, List<String> rawCells) {
        int idx = firstHeaderIndex(columns, List.of("잔액"));
        if (idx < 0) return BigDecimal.ZERO;
        BigDecimal parsed = parseBankMoney(cell(rawCells, idx));
        return parsed == null ? BigDecimal.ZERO : parsed;
    }

    private BankImportAmount pickBankAmount(List<String> columns, List<String> rawCells) {
        BigDecimal deposit = null;
        BigDecimal withdrawal = null;
        BigDecimal generic = null;
        for (int i = 0; i < columns.size(); i++) {
            String header = normalizeKey(columns.get(i));
            if (header.contains(normalizeKey("잔액"))) continue;
            BigDecimal parsed = parseBankMoney(cell(rawCells, i));
            if (parsed == null || parsed.compareTo(BigDecimal.ZERO) == 0) continue;
            if (header.contains(normalizeKey("입금"))) {
                deposit = parsed.abs();
            } else if (header.contains(normalizeKey("출금")) || header.contains(normalizeKey("공급가액"))) {
                withdrawal = parsed.abs();
            } else if (header.contains(normalizeKey("금액")) || header.contains("amount")) {
                generic = parsed;
            }
        }
        if (deposit != null) return new BankImportAmount(deposit);
        if (withdrawal != null) return new BankImportAmount(withdrawal.negate());
        if (generic != null) return new BankImportAmount(generic);
        return new BankImportAmount(null);
    }

    private BigDecimal parseBankMoney(String raw) {
        String value = normalizeText(raw);
        if (value.isBlank()) return null;
        boolean wrappedNegative = value.startsWith("(") && value.endsWith(")");
        String cleaned = value.replace(",", "").replace("원", "").replace("+", "").replace("(", "").replace(")", "").trim();
        if (cleaned.isBlank() || "-".equals(cleaned)) return null;
        try {
            BigDecimal parsed = new BigDecimal(cleaned);
            return wrappedNegative ? parsed.abs().negate() : parsed;
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private int firstHeaderIndex(List<String> columns, List<String> aliases) {
        for (String alias : aliases) {
            String key = normalizeKey(alias);
            for (int i = 0; i < columns.size(); i++) {
                if (normalizeKey(columns.get(i)).equals(key)) return i;
            }
        }
        for (String alias : aliases) {
            String key = normalizeKey(alias);
            for (int i = 0; i < columns.size(); i++) {
                String header = normalizeKey(columns.get(i));
                if (!header.isBlank() && header.contains(key)) return i;
            }
        }
        return -1;
    }

    private List<Integer> headerIndices(List<String> columns, List<String> aliases) {
        List<Integer> indices = new ArrayList<>();
        Set<Integer> seen = new LinkedHashSet<>();
        for (String alias : aliases) {
            String key = normalizeKey(alias);
            for (int i = 0; i < columns.size(); i++) {
                String header = normalizeKey(columns.get(i));
                if (!header.isBlank() && (header.equals(key) || header.contains(key)) && seen.add(i)) {
                    indices.add(i);
                }
            }
        }
        return indices;
    }

    private String normalizeText(String value) {
        return value == null ? "" : value.replace('\u00a0', ' ').trim().replaceAll("\\s+", " ");
    }

    private String normalizeKey(String value) {
        return normalizeText(value).toLowerCase(Locale.ROOT).replaceAll("[\\s_\\-./()\\[\\]]+", "");
    }

    private String cell(List<String> cells, int index) {
        return index >= 0 && index < cells.size() ? normalizeText(cells.get(index)) : "";
    }

    private String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private String twoDigits(String value) {
        return String.format("%02d", Integer.parseInt(value));
    }

    private Set<Integer> touchedRows(List<SaveDraftRequest.RowPatch> rows) {
        Set<Integer> touched = new LinkedHashSet<>();
        for (SaveDraftRequest.RowPatch row : rows) touched.add(row.rowIndex());
        return touched;
    }

    private int countCells(WeeklyExpenseSheetEntity sheet) {
        int count = 0;
        for (WeeklyExpenseRowEntity row : sheet.getRows()) count += row.getCells().size();
        return count;
    }

    private String normalizeRole(String role) {
        return role == null || role.isBlank() ? "unknown" : role.trim().toLowerCase(Locale.ROOT);
    }

    private String metadataJson(
        TrustedActorContext actor,
        WeeklyExpenseSheetEntity sheet,
        List<CellValidationIssue> issues,
        List<SaveDraftResponse.ActualDelta> actualDelta
    ) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("sheetId", sheet.getId());
        metadata.put("sheetKey", sheet.getSheetKey());
        metadata.put("sheetVersion", sheet.getSheetVersion());
        metadata.put("rowCount", sheet.getRows().size());
        metadata.put("cellCount", countCells(sheet));
        metadata.put("validationIssueCount", issues.size());
        metadata.put("actualDeltaCount", actualDelta.size());
        metadata.put("actorEmail", actor.email());
        return writeJson(metadata);
    }

    private String projectionMetadataJson(TrustedActorContext actor, int lineCount) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("lineCount", lineCount);
        metadata.put("actorEmail", actor.email());
        return writeJson(metadata);
    }

    private String normalizeExportFormat(String format) {
        String value = format == null || format.isBlank() ? "CSV" : format.trim().toUpperCase(Locale.ROOT);
        if (!"CSV".equals(value)) {
            throw new IllegalArgumentException("Only CSV audit exports are supported.");
        }
        return value;
    }

    private String buildAuditExportCsv(
        String projectId,
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual,
        List<WeeklyExpenseAuditEventEntity> auditEvents
    ) {
        StringBuilder out = new StringBuilder();
        out.append(csvLine("section", "projectId", "yearMonth", "weekNo", "sheetKey", "cashflowLine", "amount", "commandName", "actorId", "actorRole", "idempotencyKey", "createdAt"));
        for (WeeklyExpenseProjectionEntity line : projection) {
            out.append(csvLine(
                "PROJECTION",
                projectId,
                line.getYearMonth(),
                String.valueOf(line.getWeekNo()),
                "",
                line.getCashflowLine(),
                line.getAmount().toPlainString(),
                "",
                "",
                "",
                "",
                ""
            ));
        }
        for (WeeklyExpenseActualEntity line : actual) {
            out.append(csvLine(
                "ACTUAL",
                projectId,
                line.getYearMonth(),
                String.valueOf(line.getWeekNo()),
                line.getSheetKey(),
                line.getCashflowLine(),
                line.getAmount().toPlainString(),
                "",
                "",
                "",
                "",
                ""
            ));
        }
        for (WeeklyExpenseAuditEventEntity event : auditEvents) {
            out.append(csvLine(
                "AUDIT_SUMMARY",
                projectId,
                "",
                "",
                event.getSheetKey(),
                "",
                "",
                event.getCommandName(),
                event.getActorId(),
                event.getActorRole(),
                event.getIdempotencyKey(),
                event.getCreatedAt().toString()
            ));
        }
        return out.toString();
    }

    private String csvLine(String... values) {
        List<String> escaped = new ArrayList<>();
        for (String value : values) {
            escaped.add(csvEscape(value));
        }
        return String.join(",", escaped) + "\n";
    }

    private String csvEscape(String value) {
        String text = csvFormulaSafeValue(value == null ? "" : value);
        if (text.contains("\"") || text.contains(",") || text.contains("\n") || text.contains("\r")) {
            return "\"" + text.replace("\"", "\"\"") + "\"";
        }
        return text;
    }

    private String csvFormulaSafeValue(String value) {
        String text = value == null ? "" : value;
        String leadingTrimmed = text.stripLeading();
        if (leadingTrimmed.isEmpty()) return text;
        char first = leadingTrimmed.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@') {
            return "'" + text;
        }
        return text;
    }

    private String sanitizeFileName(String value) {
        String text = value == null || value.isBlank() ? "project" : value.trim();
        return text.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private String text(String value) {
        return value == null ? "" : value;
    }

    private String hashJson(Object request) {
        return sha256(writeJson(request));
    }

    private <T> Optional<T> readIdempotentResponse(
        String tenantId,
        String projectId,
        String commandName,
        String idempotencyKey,
        String requestHash,
        Class<T> responseType
    ) {
        Optional<WeeklyExpenseIdempotencyEntity> existing = persistence.findIdempotency(
            tenantId,
            projectId,
            commandName,
            idempotencyKey
        );
        if (existing.isEmpty()) return Optional.empty();

        WeeklyExpenseIdempotencyEntity idempotency = existing.get();
        if (!idempotency.getRequestHash().equals(requestHash)) {
            throw new WeeklyExpenseConflictException("Idempotency key already exists with a different request body.");
        }
        return Optional.of(readJson(idempotency.getResponseJson(), responseType));
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : hashed) out.append(String.format("%02x", b));
            return out.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is not available", error);
        }
    }

    private <T> T readJson(String json, Class<T> type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored idempotent response is invalid JSON", error);
        }
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Could not serialize weekly expense command payload", error);
        }
    }

    private List<String> readStringList(String json) {
        try {
            return objectMapper.readerForListOf(String.class).readValue(json == null || json.isBlank() ? "[]" : json);
        } catch (Exception error) {
            return List.of();
        }
    }

    private static String normalizeImportLineStatus(String status) {
        if (status == null || status.isBlank()) {
            return "staged";
        }
        String normalized = status.trim().toLowerCase(Locale.ROOT);
        return "all".equals(normalized) ? null : normalized;
    }

    private record WeekKey(String yearMonth, int weekNo) {
    }

    private record BankImportAmount(BigDecimal signedAmount) {
    }

    private record CanonicalBankImportLine(
        int lineIndex,
        String sourceLineKey,
        String transactionDate,
        String counterparty,
        String memo,
        BigDecimal signedAmount,
        BigDecimal balanceAfter,
        List<String> rawCells
    ) {
    }

    private static final class ProjectionLineAccumulator {
        private final String yearMonth;
        private final int weekNo;
        private final String cashflowLine;
        private BigDecimal amount;

        private ProjectionLineAccumulator(String yearMonth, int weekNo, String cashflowLine, BigDecimal amount) {
            this.yearMonth = yearMonth;
            this.weekNo = weekNo;
            this.cashflowLine = cashflowLine;
            this.amount = amount;
        }

        private void add(BigDecimal nextAmount) {
            this.amount = this.amount.add(nextAmount);
        }
    }

    private record ExistingRowIdentity(String id, long rowVersion, String sourceTxId) {
    }
}
