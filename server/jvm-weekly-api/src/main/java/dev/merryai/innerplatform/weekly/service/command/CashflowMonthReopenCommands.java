package dev.merryai.innerplatform.weekly.service.command;

import java.util.Locale;

/**
 * 월 재오픈 커맨드 - 런타임 중립 입력.
 *
 * <p>애플리케이션 서비스가 api DTO 를 시그니처로 받으면 service → api 역의존이 되고,
 * 그 역의존이 storage 까지 전염돼 있었다(영속 인터페이스가 api DTO 19개를 import).
 * 서비스와 영속 계층은 이 record 만 알고, HTTP 표현(Bean Validation 애노테이션)은 api
 * 계층이 소유한 채 DTO -> 커맨드 매핑만 한다. CommandService 의 api DTO 의존 47개를
 * 걷어내는 방향의 첫 수직 절단이다.
 *
 * <p>정규화(트리밍, 대문자)는 DTO 의 compact constructor 와 동일하게 여기서도 한다 -
 * 커맨드가 어디서 만들어지든 같은 형태가 되도록.
 */
public final class CashflowMonthReopenCommands {

    private CashflowMonthReopenCommands() {
    }

    public record RequestReopen(
        String idempotencyKey,
        String yearMonth,
        long expectedRevision,
        String reason,
        String requestId,
        String cycleYearMonth,
        String monthCloseTargetYearMonth,
        long evidenceRevision,
        String manifestHash,
        long expectedWorkflowRevision
    ) {
        public RequestReopen {
            reason = reason == null ? "" : reason.trim();
            requestId = normalized(requestId);
            cycleYearMonth = normalized(cycleYearMonth);
            monthCloseTargetYearMonth = normalized(monthCloseTargetYearMonth);
            manifestHash = normalized(manifestHash);
        }

        public RequestReopen(
            String idempotencyKey,
            String yearMonth,
            long expectedRevision,
            String reason
        ) {
            this(idempotencyKey, yearMonth, expectedRevision, reason, "", "", "", 0, "", 0);
        }
    }

    public record DecideReopen(
        String idempotencyKey,
        String yearMonth,
        long expectedRevision,
        String decision,
        String reason,
        String requestId,
        String cycleYearMonth,
        String monthCloseTargetYearMonth,
        long evidenceRevision,
        String manifestHash,
        long expectedWorkflowRevision
    ) {
        public DecideReopen {
            decision = decision == null ? "" : decision.trim().toUpperCase(Locale.ROOT);
            reason = reason == null ? "" : reason.trim();
            requestId = normalized(requestId);
            cycleYearMonth = normalized(cycleYearMonth);
            monthCloseTargetYearMonth = normalized(monthCloseTargetYearMonth);
            manifestHash = normalized(manifestHash);
        }

        public DecideReopen(
            String idempotencyKey,
            String yearMonth,
            long expectedRevision,
            String decision,
            String reason
        ) {
            this(idempotencyKey, yearMonth, expectedRevision, decision, reason, "", "", "", 0, "", 0);
        }
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim();
    }
}
