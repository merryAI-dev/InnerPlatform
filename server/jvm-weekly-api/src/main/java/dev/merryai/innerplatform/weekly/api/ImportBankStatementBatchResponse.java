package dev.merryai.innerplatform.weekly.api;

import java.math.BigDecimal;
import java.util.List;

public record ImportBankStatementBatchResponse(
    boolean ok,
    String commandName,
    String projectId,
    String batchId,
    int stagedLineCount,
    int duplicateLineCount,
    List<LineResult> lines,
    String auditId
) {
    public record LineResult(
        String id,
        int lineIndex,
        String sourceLineKey,
        String status,
        BigDecimal signedAmount,
        boolean duplicate
    ) {
    }
}
