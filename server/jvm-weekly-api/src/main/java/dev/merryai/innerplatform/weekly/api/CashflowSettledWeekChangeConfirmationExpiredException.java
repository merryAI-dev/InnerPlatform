package dev.merryai.innerplatform.weekly.api;

public final class CashflowSettledWeekChangeConfirmationExpiredException extends RuntimeException {
    public CashflowSettledWeekChangeConfirmationExpiredException() {
        super("주간 정산 상태가 바뀌었습니다. 시트 값을 다시 확인해 주세요.");
    }
}
