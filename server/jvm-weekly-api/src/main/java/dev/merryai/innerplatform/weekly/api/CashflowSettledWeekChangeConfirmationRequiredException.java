package dev.merryai.innerplatform.weekly.api;

import java.util.List;
public final class CashflowSettledWeekChangeConfirmationRequiredException extends RuntimeException {
    private final String confirmationId;
    private final String targetRevision;
    private final List<CashflowSettledWeekChangeConfirmation.Week> weeks;

    public CashflowSettledWeekChangeConfirmationRequiredException(
        String confirmationId,
        String targetRevision,
        List<CashflowSettledWeekChangeConfirmation.Week> weeks
    ) {
        super("주간 정산 값과 시트 값이 다릅니다.");
        this.confirmationId = confirmationId;
        this.targetRevision = targetRevision;
        this.weeks = List.copyOf(weeks);
    }

    public String confirmationId() {
        return confirmationId;
    }

    public String targetRevision() {
        return targetRevision;
    }

    public List<CashflowSettledWeekChangeConfirmation.Week> weeks() {
        return weeks;
    }
}
