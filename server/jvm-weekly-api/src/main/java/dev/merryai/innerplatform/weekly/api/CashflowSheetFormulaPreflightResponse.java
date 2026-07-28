package dev.merryai.innerplatform.weekly.api;

public record CashflowSheetFormulaPreflightResponse(
    boolean ok,
    String projectId,
    int annualCheckCount,
    int weeklyCheckCount
) {
}
