package dev.merryai.innerplatform.weekly.api;

public class WeeklyExpenseConflictException extends RuntimeException {
    public WeeklyExpenseConflictException(String message) {
        super(message);
    }
}
