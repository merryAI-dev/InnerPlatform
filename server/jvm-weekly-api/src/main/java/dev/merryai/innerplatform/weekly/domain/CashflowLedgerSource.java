package dev.merryai.innerplatform.weekly.domain;

import java.util.List;

/**
 * 원장(주간 Projection/Actual) 스냅샷. 원래 영속 인터페이스의 중첩 record 였다 -
 * 서비스와 컨트롤러가 이 타입 때문에 storage 를 import 해야 했다. 이제 세 계층이
 * 전부 도메인 타입을 본다.
 */
public record CashflowLedgerSource(
    List<WeeklyExpenseProjectionEntity> projection,
    List<WeeklyExpenseActualEntity> actual,
    String targetRevision
) {
    public CashflowLedgerSource(
        List<WeeklyExpenseProjectionEntity> projection,
        List<WeeklyExpenseActualEntity> actual
    ) {
        this(projection, actual, "");
    }

    public CashflowLedgerSource {
        projection = projection == null ? List.of() : List.copyOf(projection);
        actual = actual == null ? List.of() : List.copyOf(actual);
        targetRevision = targetRevision == null ? "" : targetRevision;
    }
}
