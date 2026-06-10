package dev.merryai.innerplatform.weekly.domain;

import java.util.Map;
import java.util.Set;

public final class CashflowLineCatalog {
    public static final Set<String> IN_LINES = Set.of(
        "MYSC_PREPAY_IN",
        "SALES_IN",
        "SALES_VAT_IN",
        "TEAM_SUPPORT_IN",
        "BANK_INTEREST_IN"
    );

    public static final Set<String> OUT_LINES = Set.of(
        "DIRECT_COST_OUT",
        "INPUT_VAT_OUT",
        "MYSC_LABOR_OUT",
        "MYSC_PROFIT_OUT",
        "SALES_VAT_OUT",
        "TEAM_SUPPORT_OUT",
        "BANK_INTEREST_OUT"
    );

    private static final Map<String, String> ALIASES = Map.ofEntries(
        Map.entry("MYSC_PREPAY_IN", "MYSC_PREPAY_IN"),
        Map.entry("MYSC 선입금(잔금 등 입금 필요 시)", "MYSC_PREPAY_IN"),
        Map.entry("MYSC선입금", "MYSC_PREPAY_IN"),
        Map.entry("SALES_IN", "SALES_IN"),
        Map.entry("매출액(입금)", "SALES_IN"),
        Map.entry("매출액", "SALES_IN"),
        Map.entry("SALES_VAT_IN", "SALES_VAT_IN"),
        Map.entry("매출부가세(입금)", "SALES_VAT_IN"),
        Map.entry("매출부가세", "SALES_VAT_IN"),
        Map.entry("TEAM_SUPPORT_IN", "TEAM_SUPPORT_IN"),
        Map.entry("팀지원금(입금)", "TEAM_SUPPORT_IN"),
        Map.entry("BANK_INTEREST_IN", "BANK_INTEREST_IN"),
        Map.entry("은행이자(입금)", "BANK_INTEREST_IN"),
        Map.entry("DIRECT_COST_OUT", "DIRECT_COST_OUT"),
        Map.entry("직접사업비", "DIRECT_COST_OUT"),
        Map.entry("사업비", "DIRECT_COST_OUT"),
        Map.entry("직접사업비(공급가액)", "DIRECT_COST_OUT"),
        Map.entry("직접사업비(공급가액)+매입부가세", "DIRECT_COST_OUT"),
        Map.entry("INPUT_VAT_OUT", "INPUT_VAT_OUT"),
        Map.entry("매입부가세", "INPUT_VAT_OUT"),
        Map.entry("MYSC_LABOR_OUT", "MYSC_LABOR_OUT"),
        Map.entry("MYSC 인건비", "MYSC_LABOR_OUT"),
        Map.entry("MYSC인건비", "MYSC_LABOR_OUT"),
        Map.entry("MYSC_PROFIT_OUT", "MYSC_PROFIT_OUT"),
        Map.entry("MYSC 수익(간접비 등)", "MYSC_PROFIT_OUT"),
        Map.entry("MYSC수익", "MYSC_PROFIT_OUT"),
        Map.entry("SALES_VAT_OUT", "SALES_VAT_OUT"),
        Map.entry("매출부가세(출금)", "SALES_VAT_OUT"),
        Map.entry("TEAM_SUPPORT_OUT", "TEAM_SUPPORT_OUT"),
        Map.entry("팀지원금(출금)", "TEAM_SUPPORT_OUT"),
        Map.entry("BANK_INTEREST_OUT", "BANK_INTEREST_OUT"),
        Map.entry("은행이자(출금)", "BANK_INTEREST_OUT")
    );

    private CashflowLineCatalog() {
    }

    public static String canonicalize(String raw) {
        String normalized = raw == null ? "" : raw.replaceAll("\\s+", " ").trim();
        if (normalized.isBlank()) return "";
        String direct = ALIASES.get(normalized);
        if (direct != null) return direct;
        return ALIASES.getOrDefault(normalized.replaceAll("\\s+", ""), normalized);
    }
}
