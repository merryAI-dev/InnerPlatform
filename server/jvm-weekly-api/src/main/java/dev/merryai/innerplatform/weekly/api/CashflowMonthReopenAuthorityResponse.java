package dev.merryai.innerplatform.weekly.api;

public record CashflowMonthReopenAuthorityResponse(
    boolean ok,
    String commandName,
    String projectId,
    String availability,
    boolean canDecideReopen,
    String guide
) {
    public static CashflowMonthReopenAuthorityResponse from(
        dev.merryai.innerplatform.weekly.service.query.CashflowMonthReopenAuthorityResult result
    ) {
        String availability = result.availability().name();
        return new CashflowMonthReopenAuthorityResponse(
            true,
            result.operationId(),
            result.projectId(),
            availability,
            result.availability()
                == dev.merryai.innerplatform.weekly.service.query.CashflowMonthReopenAuthorityResult.Availability.ALLOWED,
            guide(result.availability())
        );
    }

    private static String guide(
        dev.merryai.innerplatform.weekly.service.query.CashflowMonthReopenAuthorityResult.Availability availability
    ) {
        return switch (availability) {
            case ALLOWED -> "재오픈 결정 권한을 확인했어요.";
            case FORBIDDEN ->
                "현재 프로젝트의 활성 조직장 또는 Runtime 관리자만 재오픈을 결정할 수 있어요. 담당 조직장을 확인해 주세요.";
            case UNAVAILABLE -> "재오픈 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
        };
    }
}
