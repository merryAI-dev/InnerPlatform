package dev.merryai.innerplatform.weekly.api;

public class WeeklyExpenseEditLeaseException extends RuntimeException {
    private final int statusCode;
    private final String code;

    public WeeklyExpenseEditLeaseException(int statusCode, String code, String message) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }

    public int statusCode() {
        return statusCode;
    }

    public String code() {
        return code;
    }
}
