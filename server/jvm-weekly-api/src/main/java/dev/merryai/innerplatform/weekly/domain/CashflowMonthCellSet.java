package dev.merryai.innerplatform.weekly.domain;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 한 달 결산 셀 집합의 완전성 규칙. 라인 16종 x 모드 2 x 주차 5 = 160셀이 전부 있어야
 * 하고, 상태(VALUE/ZERO/EMPTY)와 금액의 정합이 맞아야 하며, 중복이 없어야 한다.
 *
 * <p>이 규칙은 원래 api DTO(CashflowSheetLabApplyRequest.requireCompleteMonth)에 있었다.
 * 업무 규칙이 HTTP 표현 계층에 있으면 service 가 api 를 의존하는 역방향이 강제된다.
 * DTO 는 이제 표현 <-> 도메인 매핑만 하고, 규칙은 여기 있다. 예외 메시지는 이동 전과
 * 문자 그대로 동일하다 - 행동 보존.
 */
public final class CashflowMonthCellSet {

    public record Cell(
        String mode,
        int weekNo,
        String cashflowLine,
        String cellState,
        BigDecimal amount,
        String sourceCell,
        String sourceLabel
    ) {
    }

    private CashflowMonthCellSet() {
    }

    /** 검증 + 정규화(라인 canonicalize, 상태 대문자). 실패는 IllegalArgumentException. */
    public static List<Cell> requireComplete(List<Cell> cells) {
        if (cells == null || cells.size() != CashflowLineCatalog.monthCellCount()) {
            throw new IllegalArgumentException(
                "Cashflow sheet month must contain exactly five weeks with complete cells (160 cells)."
            );
        }

        Map<String, Cell> cellsByKey = new LinkedHashMap<>();
        for (Cell cell : cells) {
            if (cell == null || cell.weekNo() < 1 || cell.weekNo() > CashflowLineCatalog.WEEKS_PER_MONTH) {
                throw new IllegalArgumentException("Cashflow sheet month must contain exactly five weeks.");
            }
            String lineId = CashflowLineCatalog.canonicalize(cell.cashflowLine());
            if (lineId.isBlank() || !CashflowLineCatalog.ALL_LINES.contains(lineId)) {
                throw new IllegalArgumentException("Unsupported cashflow line.");
            }
            String state = cell.cellState() == null
                ? ""
                : cell.cellState().trim().toUpperCase(Locale.ROOT);
            if (("VALUE".equals(state) || "ZERO".equals(state)) && cell.amount() == null) {
                throw new IllegalArgumentException("VALUE cashflow cells require an amount.");
            }
            if ("VALUE".equals(state) || "ZERO".equals(state)) {
                try {
                    cell.amount().longValueExact();
                } catch (ArithmeticException error) {
                    throw new IllegalArgumentException(
                        "Cashflow amounts must be whole won values in the supported range."
                    );
                }
            }
            if ("ZERO".equals(state) && cell.amount().compareTo(BigDecimal.ZERO) != 0) {
                throw new IllegalArgumentException("ZERO cashflow cells require an explicit zero amount.");
            }
            if ("EMPTY".equals(state) && cell.amount() != null) {
                throw new IllegalArgumentException("EMPTY cashflow cells must not include an amount.");
            }
            if (!"VALUE".equals(state) && !"ZERO".equals(state) && !"EMPTY".equals(state)) {
                throw new IllegalArgumentException("Cashflow cellState must be VALUE, ZERO, or EMPTY.");
            }

            Cell canonical = new Cell(
                cell.mode(),
                cell.weekNo(),
                lineId,
                state,
                cell.amount(),
                cell.sourceCell(),
                cell.sourceLabel()
            );
            String key = canonical.mode() + ":" + canonical.weekNo() + ":" + canonical.cashflowLine();
            if (cellsByKey.putIfAbsent(key, canonical) != null) {
                throw new IllegalArgumentException("Cashflow sheet month contains duplicate cells.");
            }
        }

        for (int weekNo = 1; weekNo <= CashflowLineCatalog.WEEKS_PER_MONTH; weekNo += 1) {
            for (String mode : List.of("projection", "actual")) {
                for (String lineId : CashflowLineCatalog.ALL_LINES) {
                    if (!cellsByKey.containsKey(mode + ":" + weekNo + ":" + lineId)) {
                        throw new IllegalArgumentException(
                            "Cashflow sheet month must contain complete cells for exactly five weeks."
                        );
                    }
                }
            }
        }
        return List.copyOf(cellsByKey.values());
    }
}
