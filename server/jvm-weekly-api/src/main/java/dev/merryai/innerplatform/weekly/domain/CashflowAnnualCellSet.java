package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 연간 열 셀 집합의 완전성 규칙. 연간 값은 주차가 없는 단일 셀이라
 * 라인 16종 x 모드 2 = 32셀이 전부 있어야 한다. 상태/금액 정합과 중복 금지는
 * {@link CashflowMonthCellSet} 과 같은 원칙이다.
 *
 * <p>원래 api DTO(CashflowSheetAnnualApplyRequest.requireCompleteYear)에 있던 규칙을
 * 도메인으로 옮겼다. 예외 메시지는 이동 전과 문자 그대로 동일하다 - 행동 보존.
 */
public final class CashflowAnnualCellSet {

    public record Cell(
        String mode,
        String cashflowLine,
        String cellState,
        BigDecimal amount,
        String sourceCell,
        String sourceLabel
    ) {
    }

    private CashflowAnnualCellSet() {
    }

    /** 라인 x 모드. 연간 열은 주차가 없다. */
    public static int yearCellCount() {
        return CashflowLineCatalog.ALL_LINES.size() * CashflowLineCatalog.MODE_COUNT;
    }

    public static List<Cell> requireComplete(List<Cell> cells) {
        if (cells == null || cells.size() != yearCellCount()) {
            throw new IllegalArgumentException("Cashflow annual total must contain complete Projection and Actual cells.");
        }
        Map<String, Cell> cellsByKey = new LinkedHashMap<>();
        for (Cell cell : cells) {
            String lineId = CashflowLineCatalog.canonicalize(cell == null ? null : cell.cashflowLine());
            if (cell == null || lineId.isBlank() || !CashflowLineCatalog.ALL_LINES.contains(lineId)) {
                throw new IllegalArgumentException("Unsupported cashflow line.");
            }
            String mode = cell.mode() == null ? "" : cell.mode().trim().toLowerCase(Locale.ROOT);
            String state = cell.cellState() == null ? "" : cell.cellState().trim().toUpperCase(Locale.ROOT);
            if (!List.of("projection", "actual").contains(mode)) {
                throw new IllegalArgumentException("Cashflow annual mode must be projection or actual.");
            }
            if (List.of("VALUE", "ZERO").contains(state)) {
                if (cell.amount() == null) throw new IllegalArgumentException("VALUE cashflow cells require an amount.");
                try {
                    cell.amount().longValueExact();
                } catch (ArithmeticException error) {
                    throw new IllegalArgumentException("Cashflow amounts must be whole won values in the supported range.");
                }
                if ("ZERO".equals(state) && cell.amount().compareTo(BigDecimal.ZERO) != 0) {
                    throw new IllegalArgumentException("ZERO cashflow cells require an explicit zero amount.");
                }
            } else if (!"EMPTY".equals(state) || cell.amount() != null) {
                throw new IllegalArgumentException("EMPTY cashflow cells must not include an amount.");
            }
            Cell canonical = new Cell(mode, lineId, state, cell.amount(), cell.sourceCell(), cell.sourceLabel());
            if (cellsByKey.putIfAbsent(mode + ":" + lineId, canonical) != null) {
                throw new IllegalArgumentException("Cashflow annual total contains duplicate cells.");
            }
        }
        for (String mode : List.of("projection", "actual")) {
            for (String lineId : CashflowLineCatalog.ALL_LINES) {
                if (!cellsByKey.containsKey(mode + ":" + lineId)) {
                    throw new IllegalArgumentException("Cashflow annual total must contain every cashflow line.");
                }
            }
        }
        return List.copyOf(cellsByKey.values());
    }
}
