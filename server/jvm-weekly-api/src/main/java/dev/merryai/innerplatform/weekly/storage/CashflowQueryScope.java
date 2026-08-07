package dev.merryai.innerplatform.weekly.storage;

import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;

final class CashflowQueryScope {
    static final int FIRESTORE_WHERE_IN_LIMIT = 30;

    private CashflowQueryScope() {}

    static List<String> requireYearMonths(Collection<String> values) {
        if (values == null) throw new IllegalArgumentException("yearMonths must not be null.");
        LinkedHashSet<String> months = new LinkedHashSet<>();
        for (String value : values) {
            if (value == null) throw new IllegalArgumentException("yearMonth must use YYYY-MM.");
            try {
                if (!YearMonth.parse(value).toString().equals(value)) throw new DateTimeParseException("", value, 0);
            } catch (DateTimeParseException error) {
                throw new IllegalArgumentException("yearMonth must use YYYY-MM: " + value, error);
            }
            months.add(value);
        }
        return List.copyOf(months);
    }

    static List<List<String>> chunks(Collection<String> values) {
        List<String> months = requireYearMonths(values);
        List<List<String>> chunks = new ArrayList<>();
        for (int start = 0; start < months.size(); start += FIRESTORE_WHERE_IN_LIMIT) {
            chunks.add(months.subList(start, Math.min(start + FIRESTORE_WHERE_IN_LIMIT, months.size())));
        }
        return List.copyOf(chunks);
    }

    static List<String> between(String fromMonth, String throughMonth) {
        YearMonth current = YearMonth.parse(requireYearMonths(List.of(fromMonth)).getFirst());
        YearMonth end = YearMonth.parse(requireYearMonths(List.of(throughMonth)).getFirst());
        if (current.isAfter(end)) return List.of();
        List<String> months = new ArrayList<>();
        while (!current.isAfter(end)) {
            months.add(current.toString());
            current = current.plusMonths(1);
        }
        return List.copyOf(months);
    }
}
