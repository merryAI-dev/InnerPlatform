package dev.merryai.innerplatform.weekly.storage;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

@Component
public final class CashflowMonthCloseBusinessDate {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Seoul");

    private final LocalDate qaDate;

    @Autowired
    public CashflowMonthCloseBusinessDate(
        @Value("${weekly.deploy-env:local}") String deployEnv,
        @Value("${weekly.cashflow-month-close-qa-date:}") String value
    ) {
        this(parseQaDate(deployEnv, value));
    }

    CashflowMonthCloseBusinessDate(LocalDate qaDate) {
        this.qaDate = qaDate;
    }

    LocalDate currentDate(Clock clock) {
        if (qaDate != null) return qaDate;
        return LocalDate.now(clock.withZone(BUSINESS_ZONE));
    }

    boolean qaOverrideActive() {
        return qaDate != null;
    }

    static LocalDate parseQaDate(String deployEnv, String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isBlank()) return null;
        if (!"stage".equalsIgnoreCase(deployEnv == null ? "" : deployEnv.trim())) {
            throw new IllegalStateException("Cashflow month-close QA date can only be enabled in the Stage JVM runtime.");
        }
        try {
            LocalDate date = LocalDate.parse(normalized);
            if (date.getYear() < 2000 || date.getYear() > 2099) throw new IllegalArgumentException();
            return date;
        } catch (RuntimeException error) {
            throw new IllegalStateException("Cashflow month-close QA date must use a valid YYYY-MM-DD date.", error);
        }
    }
}
