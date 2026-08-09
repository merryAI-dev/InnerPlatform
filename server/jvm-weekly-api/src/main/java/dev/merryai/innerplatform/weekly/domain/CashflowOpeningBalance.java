package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** 기초잔액 읽기 모델. 영속 인터페이스의 중첩 record 에서 도메인으로 승격. */
public record CashflowOpeningBalance(
    int selectedYear,
    Mode projection,
    Mode actual
) {
    public record Mode(
        BigDecimal amount,
        Map<String, BigDecimal> lineAmounts,
        List<YearSource> sources,
        List<Integer> includedYears,
        List<Integer> excludedWeeklyYears
    ) {
        public Mode {
            amount = amount == null ? BigDecimal.ZERO : amount;
            lineAmounts = lineAmounts == null ? Map.of() : Map.copyOf(lineAmounts);
            sources = sources == null ? List.of() : List.copyOf(sources);
            includedYears = includedYears == null ? List.of() : List.copyOf(includedYears);
            excludedWeeklyYears = excludedWeeklyYears == null ? List.of() : List.copyOf(excludedWeeklyYears);
        }
    }

    public record YearSource(
        int year,
        Map<String, BigDecimal> lineAmounts,
        Map<String, String> lineStates
    ) {
        public YearSource {
            lineAmounts = lineAmounts == null ? Map.of() : Map.copyOf(lineAmounts);
            lineStates = lineStates == null ? Map.of() : Map.copyOf(lineStates);
        }
    }
}
