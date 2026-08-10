package dev.merryai.innerplatform.weekly.service.command;

import dev.merryai.innerplatform.weekly.domain.CashflowAnnualCellSet;

import java.util.List;

/**
 * 연간 열 반영 커맨드 - 런타임 중립 입력. HTTP 표현(Bean Validation)은 api DTO 가
 * 소유하고, 서비스와 영속 계층은 이 record 와 도메인 셀만 안다.
 * {@link CashflowMonthReopenCommands} 와 같은 절단 패턴이다.
 */
public record CashflowSheetAnnualApplyCommand(
    String idempotencyKey,
    String sourceRevision,
    int year,
    long expectedRevision,
    List<CashflowAnnualCellSet.Cell> cells,
    String amendmentReason,
    boolean replaceAllActualSources
) {
    public CashflowSheetAnnualApplyCommand {
        amendmentReason = amendmentReason == null ? "" : amendmentReason.trim();
        cells = cells == null ? List.of() : List.copyOf(cells);
    }

    /** 변경 사유 없는 일반 반영. DTO 의 편의 생성자와 같은 모양. */
    public CashflowSheetAnnualApplyCommand(
        String idempotencyKey,
        String sourceRevision,
        int year,
        long expectedRevision,
        List<CashflowAnnualCellSet.Cell> cells
    ) {
        this(idempotencyKey, sourceRevision, year, expectedRevision, cells, "", false);
    }
}
