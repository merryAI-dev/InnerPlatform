package dev.merryai.innerplatform.weekly.storage;

import dev.merryai.innerplatform.weekly.api.SaveDraftResponse;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

final class FirestoreCashflowWeekActualMerge {
    private FirestoreCashflowWeekActualMerge() {
    }

    static Map<String, Object> buildPatch(
        String tenantId,
        String projectId,
        String sheetKey,
        Map<String, Object> existingDoc,
        List<SaveDraftResponse.ActualDelta> sheetDeltas,
        Instant now
    ) {
        Map<String, Object> bySheet = nestedMap(existingDoc.get("weeklyExpenseActualBySheet"));
        bySheet.remove(sheetKey);
        Map<String, BigDecimal> currentSheet = new LinkedHashMap<>();
        for (SaveDraftResponse.ActualDelta delta : sheetDeltas) {
            currentSheet.merge(delta.cashflowLine(), amount(delta.amount()), BigDecimal::add);
        }
        if (!currentSheet.isEmpty()) {
            bySheet.put(sheetKey, numberMap(currentSheet));
        }

        Map<String, BigDecimal> actual = sumActualBySheet(bySheet);
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("tenantId", tenantId);
        patch.put("projectId", projectId);
        patch.put("weeklyExpenseActualBySheet", bySheet);
        patch.put("actual", numberMap(actual));
        patch.put("actualTotals", cashflowTotals(actual));
        patch.put("updatedAt", (now == null ? Instant.now() : now).toString());
        patch.put("updatedByUid", "java-weekly-api");
        patch.put("updatedByName", "Java Weekly API");
        return patch;
    }

    static Map<String, Object> numberMap(Map<String, BigDecimal> amounts) {
        Map<String, Object> result = new TreeMap<>();
        for (Map.Entry<String, BigDecimal> entry : amounts.entrySet()) {
            result.put(entry.getKey(), amount(entry.getValue()).longValue());
        }
        return result;
    }

    static Map<String, Object> cashflowTotals(Map<String, BigDecimal> amounts) {
        BigDecimal in = List.of(
            "MYSC_PREPAY_IN",
            "SALES_IN",
            "SALES_VAT_IN",
            "TEAM_SUPPORT_IN",
            "BANK_INTEREST_IN"
        ).stream()
            .map(line -> amount(amounts.get(line)))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal out = List.of(
            "DIRECT_COST_OUT",
            "INPUT_VAT_OUT",
            "MYSC_LABOR_OUT",
            "MYSC_PROFIT_OUT",
            "SALES_VAT_OUT",
            "TEAM_SUPPORT_OUT",
            "BANK_INTEREST_OUT"
        ).stream()
            .map(line -> amount(amounts.get(line)))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        return Map.of(
            "totalIn", in.longValue(),
            "totalOut", out.longValue(),
            "net", in.subtract(out).longValue()
        );
    }

    static Map<String, BigDecimal> sumActualBySheet(Map<String, Object> bySheet) {
        Map<String, BigDecimal> actual = new LinkedHashMap<>();
        for (Object value : bySheet.values()) {
            for (Map.Entry<String, Object> entry : nestedMap(value).entrySet()) {
                actual.merge(entry.getKey(), decimal(entry.getValue()), BigDecimal::add);
            }
        }
        return actual;
    }

    static Map<String, Object> nestedMap(Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (!(value instanceof Map<?, ?> map)) return result;
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            result.put(String.valueOf(entry.getKey()), entry.getValue());
        }
        return result;
    }

    private static BigDecimal amount(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static BigDecimal decimal(Object value) {
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof Number number) return BigDecimal.valueOf(number.doubleValue());
        if (value == null) return BigDecimal.ZERO;
        String text = String.valueOf(value).replace(",", "").trim();
        if (text.isBlank()) return BigDecimal.ZERO;
        try {
            return new BigDecimal(text);
        } catch (NumberFormatException error) {
            return BigDecimal.ZERO;
        }
    }
}
