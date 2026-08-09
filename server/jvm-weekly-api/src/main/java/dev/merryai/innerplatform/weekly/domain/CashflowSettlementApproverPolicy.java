package dev.merryai.innerplatform.weekly.domain;

/**
 * 정산 승인권 판정. 프로젝트에 지정된 조직장(executiveApproverId) 본인만 승인할 수 있다.
 *
 * <p>이 규칙은 원래 Firestore 영속 클래스의 package-private static 이었다. 순수 인가
 * 규칙이 영속 계층에 있으면 규칙을 테스트하려고 5천 줄짜리 저장소 클래스를 잡아야 하고,
 * BFF 쪽 대응 규칙(server/bff/routes/jvm-weekly-api.mjs 의 승인자 대조)과 나란히 놓고
 * 비교할 수도 없다. {@link CashflowMonthReopenApprovalPolicy} 와 같은 자리, 같은 모양으로
 * 둔다.
 */
public final class CashflowSettlementApproverPolicy {

    private CashflowSettlementApproverPolicy() {
    }

    /**
     * actorId 가 지정 조직장 본인일 때만 true. 조직장 미지정(빈값)이면 아무도 승인할 수 없다.
     * 비교는 저장된 값 그대로다(트리밍 없음) - 영속 계층의 기존 판정과 정확히 같다.
     */
    public static boolean isDesignatedApprover(String executiveApproverId, String actorId) {
        if (actorId == null || actorId.isBlank()) return false;
        return actorId.equals(executiveApproverId == null ? "" : executiveApproverId);
    }
}
