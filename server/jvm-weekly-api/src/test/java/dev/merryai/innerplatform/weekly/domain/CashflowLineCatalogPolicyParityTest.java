package dev.merryai.innerplatform.weekly.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 라인 카탈로그의 단일 소스는 레포 루트의 policies/cashflow-policy.json 이다. BFF 는
 * 그 JSON 을 파생해서 쓰지만(server/bff/cashflow-policy.mjs) JVM 은 하드코딩 사본을
 * 들고 있다. 사본이 갈리면 결산 셀 수부터 IN/OUT 합산까지 두 런타임이 조용히 어긋난다 -
 * 라인 하나를 추가하면 BFF 는 170셀, JVM 은 160셀이 되는 구조였다.
 *
 * <p>이 테스트는 JSON 을 직접 읽어 사본과 문자 그대로 대조한다. JSON 을 고치면 여기가
 * 깨지면서 CashflowLineCatalog 사본과 monthCellCount 계열 상수를 함께 갱신해야 함을
 * 알린다. (JVM 이 런타임에 JSON 을 읽게 하는 것은 패키징 변경이라 별도 단계다.)
 */
class CashflowLineCatalogPolicyParityTest {

    @Test
    void hardcodedCatalogMatchesThePolicyJson() throws Exception {
        Path policy = Path.of("..", "..", "policies", "cashflow-policy.json").normalize();
        assertThat(policy).exists();
        JsonNode root = new ObjectMapper().readTree(Files.readString(policy));

        Set<String> jsonIn = new HashSet<>();
        Set<String> jsonOut = new HashSet<>();
        for (JsonNode entry : root.get("lineEntries")) {
            String lineId = entry.get("lineId").asText();
            String direction = entry.get("direction").asText();
            if ("IN".equals(direction)) jsonIn.add(lineId);
            else if ("OUT".equals(direction)) jsonOut.add(lineId);
        }

        assertThat(CashflowLineCatalog.IN_LINES).isEqualTo(jsonIn);
        assertThat(CashflowLineCatalog.OUT_LINES).isEqualTo(jsonOut);
        assertThat(CashflowLineCatalog.monthCellCount())
            .isEqualTo((jsonIn.size() + jsonOut.size()) * CashflowLineCatalog.MODE_COUNT * CashflowLineCatalog.WEEKS_PER_MONTH);
    }
}
