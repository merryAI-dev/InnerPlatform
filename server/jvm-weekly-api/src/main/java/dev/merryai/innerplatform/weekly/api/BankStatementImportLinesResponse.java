package dev.merryai.innerplatform.weekly.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record BankStatementImportLinesResponse(
    boolean ok,
    String projectId,
    String status,
    List<Line> lines
) {
    public record Line(
        String id,
        String batchId,
        String uploadName,
        String batchStatus,
        String batchCreatedBy,
        Instant batchCreatedAt,
        int lineIndex,
        String sourceLineKey,
        String transactionDate,
        String counterparty,
        String memo,
        BigDecimal signedAmount,
        BigDecimal balanceAfter,
        List<String> rawCells,
        String status,
        String appliedSheetKey,
        String appliedRowId,
        Instant appliedAt,
        String appliedBy
    ) {
    }
}
