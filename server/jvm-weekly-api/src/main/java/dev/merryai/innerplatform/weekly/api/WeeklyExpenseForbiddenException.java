package dev.merryai.innerplatform.weekly.api;

public class WeeklyExpenseForbiddenException extends RuntimeException {
    private final String code;

    public WeeklyExpenseForbiddenException(String message) {
        this("weekly_expense_forbidden", message);
    }

    public WeeklyExpenseForbiddenException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
