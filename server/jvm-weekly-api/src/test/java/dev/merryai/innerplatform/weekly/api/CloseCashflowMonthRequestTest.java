package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CloseCashflowMonthRequestTest {
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void cumulativeV2CompactContractDoesNotRequireLegacyOpeningBalances() {
        CloseCashflowMonthRequest request = compactCumulativeRequest();

        assertThat(request.cumulativeV2()).isTrue();
        assertThat(validator.validate(request)).isEmpty();
    }

    /**
     * BFF 가 조직장 승인 시 실제로 보내는 본문. 두 런타임의 테스트가 각자 객체를 손으로
     * 만들면 JSON 이음매는 아무도 검증하지 않는다 - BFF 는 fetch 를 스텁하고 JVM 은 record 를
     * 직접 만든다. 그래서 BFF 테스트가 캡처한 문자열을 그대로 여기에 둔다. 한쪽이 본문 모양을
     * 바꾸면 이 테스트가 깨진다.
     *
     * 출처: server/bff/routes/jvm-weekly-api.test.mjs 의 status-review 승인 경로.
     */
    private static final String BFF_CUMULATIVE_APPROVAL_BODY = """
        {"idempotencyKey":"cumulative-v2-approve","yearMonth":"2026-08","expectedRevision":0,\
        "expectedDraftRevision":0,"humanReviewed":true,"requestId":"project-a-2026-08",\
        "requestRevision":2,\
        "manifestHash":"sha256:bf7b8f68cdbda3208c505fd76f7f642c08e8cf66abc31ddd11cfe6b1a93b2a08"}""";

    @Test
    void acceptsTheExactBodyTheBffSendsOnApproval() throws Exception {
        CloseCashflowMonthRequest request = new ObjectMapper()
            .readValue(BFF_CUMULATIVE_APPROVAL_BODY, CloseCashflowMonthRequest.class);

        // 누적 계약으로 인식되어야 셀·입금일정·확인란 없이 통과한다.
        assertThat(request.cumulativeV2()).isTrue();
        assertThat(validator.validate(request)).isEmpty();

        // requireCumulativeCloseApproval 이 헤더 대조에 쓰는 세 값이 그대로 도착해야 한다.
        assertThat(request.requestId()).isEqualTo("project-a-2026-08");
        assertThat(request.requestRevision()).isEqualTo(2);
        assertThat(request.manifestHash())
            .isEqualTo("sha256:bf7b8f68cdbda3208c505fd76f7f642c08e8cf66abc31ddd11cfe6b1a93b2a08");
        assertThat(request.idempotencyKey()).isEqualTo("cumulative-v2-approve");
        assertThat(request.yearMonth()).isEqualTo("2026-08");
        assertThat(request.expectedRevision()).isEqualTo(0);

        // 셀은 저장된 샤드에서 읽으므로 본문에는 없다. null 이 아니라 빈 목록으로 정규화된다.
        assertThat(request.cells()).isEmpty();
        assertThat(request.depositScheduleRows()).isEmpty();
        assertThat(request.confirmations()).isEmpty();
        assertThat(request.managementChecks()).isEmpty();
        assertThat(request.openingBalances()).isNull();
    }

    @Test
    void contractValidationFlagIsNotPartOfTheJvmJsonPayload() throws Exception {
        String json = new ObjectMapper().writeValueAsString(compactCumulativeRequest());

        assertThat(json).doesNotContain("openingBalancesContractValid");
    }

    @Test
    void legacyContractStillRequiresOpeningBalances() {
        CloseCashflowMonthRequest request = new CloseCashflowMonthRequest(
            "legacy-close", "", "", "2026-01", 0, 0, true,
            List.of(), List.of(), List.of(), List.of(), List.of(), null, null
        );

        assertThat(request.cumulativeV2()).isFalse();
        assertThat(validator.validate(request))
            .extracting(violation -> violation.getPropertyPath().toString())
            .contains("openingBalancesContractValid");
    }

    @Test
    void monthCloseRejectsAnUnattestedHumanReview() {
        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireHumanReviewed(false))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("explicit human review");
    }

    @Test
    void managementConfirmationsMayBeEmptyAfterDesignatedApproval() {
        assertThat(CloseCashflowMonthRequest.requireCompleteManagementConfirmations(List.of())).isEmpty();
    }

    @Test
    void depositScheduleRejectsImpossibleCalendarDate() {
        List<CloseCashflowMonthRequest.DepositScheduleRow> rows = validNotApplicableRows();
        rows.set(0, new CloseCashflowMonthRequest.DepositScheduleRow(
            1,
            "2026-02-31",
            "",
            null,
            "",
            null,
            "NOT_APPLICABLE",
            "NOT_APPLICABLE"
        ));

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireCompleteDepositSchedule(rows))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("real YYYY-MM-DD date");
    }

    @Test
    void depositScheduleRejectsFractionalWonAmount() {
        List<CloseCashflowMonthRequest.DepositScheduleRow> rows = validNotApplicableRows();
        rows.set(0, new CloseCashflowMonthRequest.DepositScheduleRow(
            1,
            "2026-06-01",
            "2026-06-05",
            new BigDecimal("1000.5"),
            "",
            null,
            "NOT_APPLICABLE",
            "CONFIRMED"
        ));

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireCompleteDepositSchedule(rows))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("whole won value");
    }

    @Test
    void openingBalanceRejectsAChangedRowCompositionEvenWhenTheTotalIsUnchanged() {
        CashflowOpeningBalancesResponse.YearSource source = new CashflowOpeningBalancesResponse.YearSource(
            2025,
            Map.of("SALES_IN", new BigDecimal("2000000")),
            completeStates("SALES_IN")
        );
        CashflowOpeningBalancesResponse.Mode projection = new CashflowOpeningBalancesResponse.Mode(
            new BigDecimal("2000000"),
            Map.of("TEAM_SUPPORT_IN", new BigDecimal("2000000")),
            List.of(source),
            List.of(2025),
            List.of()
        );
        CashflowOpeningBalancesResponse openingBalances = new CashflowOpeningBalancesResponse(
            2026,
            projection,
            new CashflowOpeningBalancesResponse.Mode(BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of())
        );

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireOpeningBalances(openingBalances, "2026-01"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("rows do not match their annual sources");
    }

    @Test
    void openingBalanceRejectsAnAnnualSourceThatOmitsCanonicalRowStates() {
        CashflowOpeningBalancesResponse.YearSource source = new CashflowOpeningBalancesResponse.YearSource(
            2025,
            Map.of("SALES_IN", new BigDecimal("2000000")),
            Map.of("SALES_IN", "VALUE")
        );
        CashflowOpeningBalancesResponse.Mode projection = new CashflowOpeningBalancesResponse.Mode(
            new BigDecimal("2000000"),
            Map.of("SALES_IN", new BigDecimal("2000000")),
            List.of(source),
            List.of(2025),
            List.of()
        );
        CashflowOpeningBalancesResponse openingBalances = new CashflowOpeningBalancesResponse(
            2026,
            projection,
            new CashflowOpeningBalancesResponse.Mode(BigDecimal.ZERO, Map.of(), List.of(), List.of(), List.of())
        );

        assertThatThrownBy(() -> CloseCashflowMonthRequest.requireOpeningBalances(openingBalances, "2026-01"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("preserve every cashflow row state");
    }

    private static Map<String, String> completeStates(String valueLine) {
        Map<String, String> states = new LinkedHashMap<>();
        for (String line : dev.merryai.innerplatform.weekly.domain.CashflowLineCatalog.ALL_LINES) {
            states.put(line, line.equals(valueLine) ? "VALUE" : "EMPTY");
        }
        return states;
    }

    private static CloseCashflowMonthRequest compactCumulativeRequest() {
        return new CloseCashflowMonthRequest(
            "cumulative-close",
            "",
            "",
            "2026-08",
            0,
            0,
            false,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "project-a-2026-08",
            2,
            "sha256:" + "a".repeat(64)
        );
    }

    private static List<CloseCashflowMonthRequest.DepositScheduleRow> validNotApplicableRows() {
        List<CloseCashflowMonthRequest.DepositScheduleRow> rows = new ArrayList<>();
        for (int weekNo = 1; weekNo <= CashflowSheetLabApplyRequest.FINANCE_WEEK_COUNT; weekNo += 1) {
            rows.add(new CloseCashflowMonthRequest.DepositScheduleRow(
                weekNo,
                "",
                "",
                null,
                "",
                null,
                "NOT_APPLICABLE",
                "NOT_APPLICABLE"
            ));
        }
        return rows;
    }

    @Test
    void managementCheckVocabularyMatchesTheBffParityTable() throws Exception {
        // BFF cashflow-management-checks.mjs 가 정확히 이 어휘를 계산의 소스로 쓴다
        // (cashflow-management-checks.test.mjs 의 parity 표). 여기의 @Pattern 이 갈리면
        // BFF 가 만든 검사 결과가 Bean Validation 에서 400 으로 거부된다.
        java.lang.reflect.RecordComponent id = java.util.Arrays.stream(
            CloseCashflowMonthRequest.ManagementCheck.class.getRecordComponents()
        ).filter(component -> component.getName().equals("id")).findFirst().orElseThrow();
        java.lang.reflect.RecordComponent status = java.util.Arrays.stream(
            CloseCashflowMonthRequest.ManagementCheck.class.getRecordComponents()
        ).filter(component -> component.getName().equals("status")).findFirst().orElseThrow();

        assertThat(id.getAccessor().getAnnotation(jakarta.validation.constraints.Pattern.class).regexp())
            .isEqualTo("labor-transfer|profit-vat-after-deposit|negative-projection-balance|future-prepay-over-million");
        assertThat(status.getAccessor().getAnnotation(jakarta.validation.constraints.Pattern.class).regexp())
            .isEqualTo("OK|WARNING|REVIEW_REQUIRED");
    }
}
