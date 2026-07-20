package dev.merryai.innerplatform.weekly.api;

import java.math.BigDecimal;
import java.util.Map;

public record CashflowSheetAnnualApplyResponse(
    boolean ok,
    String commandName,
    String projectId,
    String sourceSheetKey,
    int year,
    String sourceRevision,
    long revision,
    Map<String, BigDecimal> projection,
    Map<String, BigDecimal> actual,
    Map<String, String> projectionStates,
    Map<String, String> actualStates,
    String auditId
) {
}
