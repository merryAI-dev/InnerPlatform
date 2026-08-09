package dev.merryai.innerplatform.weekly.domain;

/** 누적 결산 헤드 읽기 모델. 영속 인터페이스의 중첩 record 에서 도메인으로 승격. */
public record CashflowCumulativeCloseHead(
    String status,
    String fromMonth,
    String closedThrough,
    String rootHash,
    long headRevision
) {}
