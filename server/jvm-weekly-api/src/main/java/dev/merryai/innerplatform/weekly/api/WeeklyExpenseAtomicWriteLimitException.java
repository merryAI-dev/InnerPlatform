package dev.merryai.innerplatform.weekly.api;

public class WeeklyExpenseAtomicWriteLimitException extends RuntimeException {
    private static final int STATUS_CODE = 422;
    private static final String CODE = "atomic_write_limit_exceeded";

    private final int expectedWriteCount;

    public WeeklyExpenseAtomicWriteLimitException(String command, int expectedWriteCount) {
        super(command + " requires " + expectedWriteCount + " writes, exceeding the Firestore atomic write limit.");
        this.expectedWriteCount = expectedWriteCount;
    }

    public int statusCode() {
        return STATUS_CODE;
    }

    public String code() {
        return CODE;
    }

    public int expectedWriteCount() {
        return expectedWriteCount;
    }
}
