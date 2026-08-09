package dev.merryai.innerplatform.weekly.domain;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BFF ↔ JVM parity 표. server/bff/cashflow-close-hash.test.mjs 가 정확히 같은 입력과
 * 기대값을 가진다. 이 표를 고치면 반드시 BFF 쪽 표도 함께 고쳐야 한다 - 두 값이 갈리면
 * 라이브에서 조직장 승인이 "근거가 손상되었습니다"(409) 로 거부된다.
 */
class CashflowCloseHashTest {

    @Test
    void simpleUnsortedKeysMatchTheBffParityTable() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("b", 1L);
        value.put("a", "x");
        assertThat(CashflowCloseHash.hash(value))
            .isEqualTo("sha256:cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246");
    }

    @Test
    void cumulativeCloseShardShapeMatchesTheBffParityTable() {
        Map<String, Object> projectionCell = new LinkedHashMap<>();
        projectionCell.put("mode", "projection");
        projectionCell.put("weekNo", 1L);
        projectionCell.put("cashflowLine", "SALES_IN");
        projectionCell.put("cellState", "EMPTY");
        projectionCell.put("amount", null);
        Map<String, Object> actualCell = new LinkedHashMap<>();
        actualCell.put("mode", "actual");
        actualCell.put("weekNo", 5L);
        actualCell.put("cashflowLine", "BANK_INTEREST_OUT");
        actualCell.put("cellState", "VALUE");
        actualCell.put("amount", 7582243L);
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("contractVersion", "cashflow-cumulative-close-v2");
        value.put("requestId", "p123-2026-08");
        value.put("requestRevision", 2L);
        value.put("projectId", "p123");
        value.put("yearMonth", "2023-01");
        value.put("cells", List.of(projectionCell, actualCell));
        value.put("source", Map.of(
            "spreadsheetId", "sheet-a",
            "sourceRevision", "sha256:" + "ab".repeat(32)
        ));
        assertThat(CashflowCloseHash.hash(value))
            .isEqualTo("sha256:12b47306a6b0e03d565d5e549d21944e9a65565b6d1cab1e34729be887169da7");
    }

    @Test
    void koreanKeysAndValuesMatchTheBffParityTable() {
        assertThat(CashflowCloseHash.hash(Map.of(
            "사유", "감사 지적으로 정정",
            "상태", "확정"
        ))).isEqualTo("sha256:66a3b9a944c4f4675af7c2066727da4d14136a6fd083c1e30fecd6849d8739b8");
    }

    @Test
    void numberFormsMatchTheBffParityTable() {
        // JS 에는 1.0 이라는 표현이 없다(JSON.stringify(1.0) === "1"). JVM 쪽은
        // stripTrailingZeros 로 같은 표현에 도달해야 한다 - Double 로 넣어 그 경로를 지난다.
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("zero", 0L);
        value.put("negative", -5L);
        value.put("big", 123456789L);
        value.put("fraction", 1.5d);
        assertThat(CashflowCloseHash.hash(value))
            .isEqualTo("sha256:1ec728a405d2d92079835069029e55b8683ae5199d6a975bb4d1ca0bfa29716d");
    }

    @Test
    void emptyCollectionsAndNullMatchTheBffParityTable() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("list", List.of());
        value.put("map", Map.of());
        value.put("nothing", null);
        assertThat(CashflowCloseHash.hash(value))
            .isEqualTo("sha256:92c9fb1a630c449e63f2a610dbd4e06d47d679ce8b711d185b765101c6943dc4");
    }

    @Test
    void doubleWholeNumbersCollapseToTheJsRepresentation() {
        // Firestore 가 double 로 저장한 7582243.0 과 long 7582243 은 같은 해시여야 한다.
        Map<String, Object> asDouble = Map.of("amount", 7582243.0d);
        Map<String, Object> asLong = Map.of("amount", 7582243L);
        assertThat(CashflowCloseHash.hash(asDouble)).isEqualTo(CashflowCloseHash.hash(asLong));
    }
}
