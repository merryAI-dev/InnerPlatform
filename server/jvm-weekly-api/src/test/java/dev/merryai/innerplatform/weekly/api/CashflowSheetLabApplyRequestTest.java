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
              "sourceRevision": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "targetRevision": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "yearMonth": "2026-07",
              "sourceSheetKey": "caller-controlled",
              "cells": [
                {
                  "mode": "actual",
                  "weekNo": 1,
                  "cashflowLine": "DIRECT_COST_OUT",
                  "cellState": "VALUE",
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
