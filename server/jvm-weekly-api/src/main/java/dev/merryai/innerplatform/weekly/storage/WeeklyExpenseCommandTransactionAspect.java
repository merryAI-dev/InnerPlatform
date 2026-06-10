package dev.merryai.innerplatform.weekly.storage;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

@Aspect
@Component
public class WeeklyExpenseCommandTransactionAspect {
    private final WeeklyExpensePersistence persistence;

    public WeeklyExpenseCommandTransactionAspect(WeeklyExpensePersistence persistence) {
        this.persistence = persistence;
    }

    @Around("execution(public * dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService.*(..))")
    public Object runInsidePersistenceTransaction(ProceedingJoinPoint joinPoint) {
        return persistence.runCommandTransaction(() -> {
            try {
                return joinPoint.proceed();
            } catch (RuntimeException | Error error) {
                throw error;
            } catch (Throwable error) {
                throw new IllegalStateException("Weekly expense command failed.", error);
            }
        });
    }
}
