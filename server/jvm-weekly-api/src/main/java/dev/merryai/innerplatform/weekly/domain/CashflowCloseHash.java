package dev.merryai.innerplatform.weekly.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 월 결산 근거 해시의 단일 소스 (JVM 쪽).
 *
 * <p>BFF 가 결산 요청의 샤드/manifest 에 이 해시를 써 두고, JVM 이 확정 직전에 같은
 * 규칙으로 다시 계산해 거부 판정에 쓴다. 두 런타임이 같은 규칙을 각자 구현하면 조용히
 * 갈린다 - SPEC-16 의 revision 해시가 실제로 갈렸다. 여기가 갈리면 조직장 승인이
 * "근거가 손상되었습니다"(409) 로 거부된다.
 *
 * <p>규칙을 이 클래스와 {@code server/bff/cashflow-close-hash.mjs} 두 곳에만 두고,
 * 같은 고정 fixture 표를 양쪽 테스트에 둔다 (CashflowCloseHashTest /
 * cashflow-close-hash.test.mjs). 한쪽을 고치면 다른 쪽 표가 깨지도록 한 것이다.
 *
 * <p>규칙: 맵 키를 재귀적으로 정렬(UTF-16 코드유닛 순) → 압축 JSON → SHA-256 →
 * "sha256:" 접두. 숫자는 JS {@code JSON.stringify} 표현에 맞춘다 -
 * {@code stripTrailingZeros} 로 1.0 → 1, 소수는 그대로.
 */
public final class CashflowCloseHash {

    private static final ObjectMapper JSON = new ObjectMapper();

    private CashflowCloseHash() {
    }

    public static String hash(Map<String, Object> value) {
        try {
            String json = JSON.writeValueAsString(canonicalValue(value));
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8));
            return "sha256:" + HexFormat.of().formatHex(digest);
        } catch (JsonProcessingException | NoSuchAlgorithmException error) {
            throw new IllegalStateException("Could not hash cashflow close evidence.", error);
        }
    }

    static Object canonicalValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                sorted.put(String.valueOf(entry.getKey()), canonicalValue(entry.getValue()));
            }
            return sorted;
        }
        if (value instanceof Iterable<?> iterable) {
            List<Object> values = new ArrayList<>();
            for (Object item : iterable) values.add(canonicalValue(item));
            return values;
        }
        if (value instanceof Number number) return normalizedNumber(number);
        return value;
    }

    /** JS 숫자 표현과의 parity: 1.0 → 1(long), 1.5 → 1.5(BigDecimal), -0 → 0. */
    public static Object normalizedNumber(Number number) {
        BigDecimal value = number instanceof BigDecimal decimal
            ? decimal
            : new BigDecimal(number.toString());
        value = value.signum() == 0 ? BigDecimal.ZERO : value.stripTrailingZeros();
        try {
            return value.longValueExact();
        } catch (ArithmeticException ignored) {
            return value;
        }
    }
}
