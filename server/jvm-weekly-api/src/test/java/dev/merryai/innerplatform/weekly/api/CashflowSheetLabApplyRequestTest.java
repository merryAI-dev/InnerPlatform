package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CashflowSheetLabApplyRequestTest {
    @Test
    void rejectsCallerControlledActualSourceSheetKey() {
        String json = """
            {
              "idempotencyKey": "apply-1",
              "sourceSheetKey": "caller-controlled",
              "lines": [
                {
                  "mode": "actual",
                  "yearMonth": "2026-07",
                  "weekNo": 1,
                  "cashflowLine": "DIRECT_COST_OUT",
                  "amount": 1000
                }
              ]
            }
            """;

        assertThatThrownBy(() -> new ObjectMapper().readValue(json, CashflowSheetLabApplyRequest.class))
            .isInstanceOf(JsonMappingException.class)
            .hasMessageContaining("sourceSheetKey");
    }
}
