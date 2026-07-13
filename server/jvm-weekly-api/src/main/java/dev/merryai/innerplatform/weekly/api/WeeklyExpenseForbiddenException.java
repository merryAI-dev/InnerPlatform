package dev.merryai.innerplatform.weekly.api;

public class WeeklyExpenseForbiddenException extends RuntimeException {
    public WeeklyExpenseForbiddenException(String message) {
        super(message);
    }
}
