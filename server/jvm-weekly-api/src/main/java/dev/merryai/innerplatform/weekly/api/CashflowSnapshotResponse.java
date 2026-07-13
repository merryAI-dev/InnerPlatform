package dev.merryai.innerplatform.weekly.api;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public record CashflowSnapshotResponse(
    String projectId,
    List<ProjectionLine> projection,
    List<ActualLine> actual,
    ReadModel readModel
) {
    public record ProjectionLine(
        String yearMonth,
        int weekNo,
        String cashflowLine,
        BigDecimal amount
    ) {
    }

    public record ActualLine(
        String sheetKey,
        String yearMonth,
        int weekNo,
        String cashflowLine,
        BigDecimal amount
    ) {
    }

    public record ReadModel(
        List<MonthReadModel> months
    ) {
    }

    public record MonthReadModel(
        String yearMonth,
        ModeReadModel projection,
        ModeReadModel actual
    ) {
    }

    public record ModeReadModel(
        Map<String, BigDecimal> rowTotals,
        List<WeekReadModel> weeks,
        CashflowTotals monthTotals
    ) {
    }

    public record WeekReadModel(
        int weekNo,
        Map<String, BigDecimal> amounts,
        BigDecimal totalIn,
        BigDecimal totalOut,
        BigDecimal net,
        BigDecimal weekIn,
        BigDecimal weekOut
    ) {
    }

    public record CashflowTotals(
        BigDecimal totalIn,
        BigDecimal totalOut,
        BigDecimal net
    ) {
    }
}
