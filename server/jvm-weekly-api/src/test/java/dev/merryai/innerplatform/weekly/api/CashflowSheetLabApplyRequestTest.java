package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
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

    @Test
    void validatesExactPendingApprovalEvidenceAndPreservesEmptyZeroDistinction() throws Exception {
        String json = """
            {
              "yearMonth":"2026-07","warningCountIncrement":1,"differenceCount":2,
              "approvalDifferences":[{
                "requestId":"request-a","requestRevision":3,"requestStatus":"APPROVING",
                "requestManifestHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "yearMonth":"2026-07","differenceCount":2,"weeks":[1],"truncatedChangeCount":0,
                "changes":[
                  {"mode":"projection","weekNo":1,"lineId":"SALES_IN","beforeHadValue":false,"beforeState":"EMPTY","beforeAmount":null,"afterHadValue":true,"afterState":"ZERO","afterAmount":0},
                  {"mode":"actual","weekNo":1,"lineId":"SALES_IN","beforeHadValue":true,"beforeState":"ZERO","beforeAmount":0,"afterHadValue":true,"afterState":"VALUE","afterAmount":100}
                ]
              }]
            }
            """;
        CashflowPendingApprovalAffectedMonth instruction = new ObjectMapper().readValue(
            json, CashflowPendingApprovalAffectedMonth.class
        );

        assertThat(CashflowPendingApprovalAffectedMonth.requireValid(
            List.of(instruction), List.of("2026-07")
        )).singleElement().satisfies(value -> {
            assertThat(value.differenceCount()).isEqualTo(2);
            assertThat(value.approvalDifferences().getFirst().changes().getFirst().beforeAmount()).isNull();
            assertThat(value.approvalDifferences().getFirst().changes().getFirst().afterAmount())
                .isEqualByComparingTo(BigDecimal.ZERO);
        });
    }

    @Test
    void rejectsForgedPendingApprovalCountsDuplicateCellsAndOutOfScopeMonth() throws Exception {
        CashflowPendingApprovalAffectedMonth.Change change = new CashflowPendingApprovalAffectedMonth.Change(
            "projection", 1, "SALES_IN", false, "EMPTY", null, true, "ZERO", BigDecimal.ZERO
        );
        CashflowPendingApprovalAffectedMonth.ApprovalDifference difference =
            new CashflowPendingApprovalAffectedMonth.ApprovalDifference(
                "request-a", 1, "PENDING", "sha256:" + "a".repeat(64), "2026-07", 2,
                List.of(1), List.of(change, change), 0
            );
        CashflowPendingApprovalAffectedMonth instruction = new CashflowPendingApprovalAffectedMonth(
            "2026-07", 1, 2, List.of(difference)
        );

        assertThatThrownBy(() -> CashflowPendingApprovalAffectedMonth.requireValid(
            List.of(instruction), List.of("2026-07")
        )).hasMessageContaining("duplicate");
        CashflowPendingApprovalAffectedMonth.ApprovalDifference oneChange =
            new CashflowPendingApprovalAffectedMonth.ApprovalDifference(
                "request-a", 1, "PENDING", "sha256:" + "a".repeat(64), "2026-07", 1,
                List.of(1), List.of(change), 0
            );
        assertThatThrownBy(() -> CashflowPendingApprovalAffectedMonth.requireValid(
            List.of(new CashflowPendingApprovalAffectedMonth("2026-07", 1, 2, List.of(oneChange))),
            List.of("2026-07")
        )).hasMessageContaining("differenceCount");
        assertThatThrownBy(() -> CashflowPendingApprovalAffectedMonth.requireValid(
            List.of(new CashflowPendingApprovalAffectedMonth("2026-08", 1, 2, List.of(difference))),
            List.of("2026-07")
        )).hasMessageContaining("outside");
    }
}
