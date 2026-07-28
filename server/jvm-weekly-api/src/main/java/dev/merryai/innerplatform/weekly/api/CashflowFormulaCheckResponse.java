package dev.merryai.innerplatform.weekly.api;

import java.math.BigDecimal;
import java.util.Map;

public record CashflowFormulaCheckResponse(
    String yearMonth,
    String mode,
    int weekNo,
    Amounts reported,
    Amounts calculated,
    Matches matches,
    Map<String, String> sourceCells
) {
    public record Amounts(
        BigDecimal openingBalance,
        BigDecimal depositTotal,
        BigDecimal withdrawalTotal,
        BigDecimal balance
    ) {
    }

    public record Matches(
        Boolean depositTotal,
        Boolean withdrawalTotal,
        Boolean balance
    ) {
    }
}
