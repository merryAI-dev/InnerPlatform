package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;

public final class WeeklyExpenseFormulaEngine {
    private WeeklyExpenseFormulaEngine() {
    }

    public static RowFormulaResult evaluateRow(WeeklyExpenseRowEntity row) {
        BigDecimal deposit = safe(row.getDepositAmount());
        BigDecimal vatRefund = safe(row.getRefundAmount());
        BigDecimal expense = safe(row.getExpenseAmount());
        BigDecimal vatIn = safe(row.getVatInAmount());
        BigDecimal bank = safe(row.getBankAmount());

        BigDecimal actualAmount = firstNonZero(expense, deposit, bank.abs());
        BigDecimal cashMovement = deposit
            .add(vatRefund)
            .subtract(expense)
            .subtract(vatIn);
        if (cashMovement.signum() == 0) {
            cashMovement = bank;
        }

        return new RowFormulaResult(actualAmount, cashMovement);
    }

    private static BigDecimal firstNonZero(BigDecimal... values) {
        for (BigDecimal value : values) {
            BigDecimal safeValue = safe(value);
            if (safeValue.signum() != 0) return safeValue;
        }
        return BigDecimal.ZERO;
    }

    private static BigDecimal safe(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    public record RowFormulaResult(
        BigDecimal actualAmount,
        BigDecimal cashMovement
    ) {
    }
}
