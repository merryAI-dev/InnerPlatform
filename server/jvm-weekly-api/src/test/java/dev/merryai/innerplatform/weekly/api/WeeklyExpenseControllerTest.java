package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseActualRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseAuditEventRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseAuditExportRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseBankImportLineRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseIdempotencyRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseProjectionRepository;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseSheetRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import jakarta.servlet.http.Cookie;

import java.util.ArrayList;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class WeeklyExpenseControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private WeeklyExpenseSheetRepository sheetRepository;

    @Autowired
    private WeeklyExpenseActualRepository actualRepository;

    @Autowired
    private WeeklyExpenseProjectionRepository projectionRepository;

    @Autowired
    private WeeklyExpenseAuditEventRepository auditEventRepository;

    @Autowired
    private WeeklyExpenseIdempotencyRepository idempotencyRepository;

    @Autowired
    private WeeklyExpenseAuditExportRepository auditExportRepository;

    @Autowired
    private WeeklyExpenseBankImportLineRepository bankImportLineRepository;

    private static MockHttpServletRequestBuilder asActor(
        MockHttpServletRequestBuilder request,
        String tenantId,
        String actorId,
        String role
    ) {
        return request
            .header(InternalServiceTokenFilter.HEADER_NAME, "test-weekly-api-token")
            .header("x-tenant-id", tenantId)
            .header("x-actor-id", actorId)
            .header("x-actor-role", role)
            .header("x-actor-email", actorId + "@example.com");
    }

    private static MockHttpServletRequestBuilder asFirebaseActor(
        MockHttpServletRequestBuilder request,
        String tenantId,
        String actorId,
        String role,
        String email
    ) {
        return request
            .header("authorization", "Bearer " + firebaseTestToken(tenantId, actorId, role, email))
            .header("x-tenant-id", tenantId);
    }

    private static String firebaseTestToken(String tenantId, String actorId, String role, String email) {
        String claims = "uid=%s;tenantId=%s;role=%s;email=%s".formatted(actorId, tenantId, role, email);
        return "test-firebase:" + Base64.getUrlEncoder().encodeToString(claims.getBytes(StandardCharsets.UTF_8));
    }

    private static String firebaseTestSessionCookie(String tenantId, String actorId, String role, String email) {
        return firebaseTestToken(tenantId, actorId, role, email).replace("test-firebase:", "test-firebase-session:");
    }

    @Test
    void javaApiRejectsTrustedActorHeadersWithoutAnyRuntimeAuth() throws Exception {
        String body = """
            {
              "idempotencyKey": "missing-service-token",
              "rows": []
            }
            """;

        mockMvc.perform(post("/api/v1/weekly-expenses/project-auth/sheets/default/save-draft")
                .header("x-tenant-id", "tenant-auth")
                .header("x-actor-id", "spoofed-admin")
                .header("x-actor-role", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("weekly_expense_firebase_auth_required"));
    }

    @Test
    void browserDirectFirebaseTokenCanRunJavaCommandWithoutBffServiceToken() throws Exception {
        String body = """
            {
              "idempotencyKey": "direct-firebase-save-001",
              "sheetName": "direct",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true},
                    {"columnIndex": 13, "rawValue": "7000", "userEdited": true}
                  ]
                }
              ]
            }
            """;

        mockMvc.perform(asFirebaseActor(
                post("/api/v1/weekly-expenses/project-direct/sheets/default/save-draft"),
                "tenant-direct",
                "firebase-pm-1",
                "pm",
                "pm@mysc.co.kr"
            )
                .header("x-actor-id", "firebase-pm-1")
                .header("x-actor-role", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.saveDraft"))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(7000));

        assertThat(auditEventRepository.findByTenantIdAndProjectIdOrderByCreatedAtAsc("tenant-direct", "project-direct"))
            .singleElement()
            .extracting("actorRole")
            .isEqualTo("pm");
    }

    @Test
    void firebaseIdTokenCreatesHttpOnlySessionCookie() throws Exception {
        String idToken = firebaseTestToken("tenant-session", "firebase-pm-session", "pm", "pm-session@mysc.co.kr");
        String setCookie = mockMvc.perform(post("/api/v1/auth/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"idToken\":\"" + idToken + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.actorId").value("firebase-pm-session"))
            .andExpect(jsonPath("$.tenantId").value("tenant-session"))
            .andReturn()
            .getResponse()
            .getHeader("Set-Cookie");

        assertThat(setCookie).contains(WeeklyAuthSessionController.SESSION_COOKIE_NAME + "=");
        assertThat(setCookie).contains("HttpOnly");
        assertThat(setCookie).contains("Secure");
        assertThat(setCookie).contains("SameSite=None");
        assertThat(setCookie).contains("Path=/");
    }

    @Test
    void firebaseSessionCookieCanRunJavaCommandWithoutPerRequestBearerToken() throws Exception {
        String body = """
            {
              "idempotencyKey": "session-cookie-save-001",
              "sheetName": "session",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true},
                    {"columnIndex": 13, "rawValue": "8100", "userEdited": true}
                  ]
                }
              ]
            }
            """;

        mockMvc.perform(post("/api/v1/weekly-expenses/project-session/sheets/default/save-draft")
                .cookie(new Cookie(
                    WeeklyAuthSessionController.SESSION_COOKIE_NAME,
                    firebaseTestSessionCookie("tenant-session", "firebase-pm-session", "pm", "pm-session@mysc.co.kr")
                ))
                .header("x-request-id", "req-session-cookie-save")
                .header("x-tenant-id", "tenant-session")
                .header("x-actor-id", "firebase-pm-session")
                .header("x-actor-role", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.saveDraft"))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(8100));

        assertThat(auditEventRepository.findByTenantIdAndProjectIdOrderByCreatedAtAsc("tenant-session", "project-session"))
            .singleElement()
            .extracting("actorRole")
            .isEqualTo("pm");
    }

    @Test
    void firebaseSessionCookieMutationsRequireRequestIdHeader() throws Exception {
        mockMvc.perform(post("/api/v1/weekly-expenses/project-session/sheets/default/save-draft")
                .cookie(new Cookie(
                    WeeklyAuthSessionController.SESSION_COOKIE_NAME,
                    firebaseTestSessionCookie("tenant-session", "firebase-pm-session", "pm", "pm-session@mysc.co.kr")
                ))
                .header("x-tenant-id", "tenant-session")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"idempotencyKey\":\"missing-request-id\",\"rows\":[]}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("weekly_expense_csrf_header_required"));
    }

    @Test
    void browserDirectFirebaseTokenRejectsSpoofedTenantAndActorHeaders() throws Exception {
        String body = """
            {
              "idempotencyKey": "direct-firebase-spoof-001",
              "rows": []
            }
            """;

        mockMvc.perform(post("/api/v1/weekly-expenses/project-direct/sheets/default/save-draft")
                .header("authorization", "Bearer " + firebaseTestToken("tenant-direct", "firebase-pm-1", "pm", "pm@mysc.co.kr"))
                .header("x-tenant-id", "tenant-other")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("tenant_mismatch"));

        mockMvc.perform(post("/api/v1/weekly-expenses/project-direct/sheets/default/save-draft")
                .header("authorization", "Bearer " + firebaseTestToken("tenant-direct", "firebase-pm-1", "pm", "pm@mysc.co.kr"))
                .header("x-tenant-id", "tenant-direct")
                .header("x-actor-id", "spoofed-admin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.replace("direct-firebase-spoof-001", "direct-firebase-spoof-002")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("actor_mismatch"));
    }

    @Test
    void cashflowReadRequiresJavaAuthorization() throws Exception {
        mockMvc.perform(asActor(get("/api/v1/cashflow/project-auth"), "tenant-auth", "unknown-1", "unknown"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("weekly_expense_forbidden"));

        mockMvc.perform(asActor(get("/api/v1/cashflow/project-auth"), "tenant-auth", "auditor-1", "auditor"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.projectId").value("project-auth"));
    }

    @Test
    void saveDraftPersistsRowsActualsAuditAndIdempotentResponse() throws Exception {
        String body = """
            {
              "idempotencyKey": "idem-001",
              "sheetName": "기본 탭",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true},
                    {"columnIndex": 13, "rawValue": "1,200,000", "userEdited": true}
                  ]
                }
              ]
            }
            """;

        String firstResponse = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-a/sheets/default/save-draft"), "tenant-a", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.saveDraft"))
            .andExpect(jsonPath("$.savedRowCount").value(1))
            .andExpect(jsonPath("$.savedCellCount").value(3))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(1200000))
            .andReturn()
            .getResponse()
            .getContentAsString();

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-a/sheets/default/save-draft"), "tenant-a", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.auditId").value(objectMapper.readTree(firstResponse).get("auditId").asText()));

        assertThat(sheetRepository.findByTenantIdAndProjectIdAndSheetKey("tenant-a", "project-a", "default")).isPresent();
        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-a", "project-a")).hasSize(1);
        assertThat(auditEventRepository.findAll()).hasSize(1);
        assertThat(idempotencyRepository.findByTenantIdAndIdempotencyKey("tenant-a", "idem-001")).isPresent();

        mockMvc.perform(asActor(get("/api/v1/cashflow/project-a"), "tenant-a", "viewer-a", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.actual[0].sheetKey").value("default"))
            .andExpect(jsonPath("$.actual[0].amount").value(1200000))
            .andExpect(jsonPath("$.readModel.months[0].yearMonth").value("2026-06"))
            .andExpect(jsonPath("$.readModel.months[0].actual.rowTotals.DIRECT_COST_OUT").value(1200000))
            .andExpect(jsonPath("$.readModel.months[0].actual.weeks[0].totalOut").value(1200000))
            .andExpect(jsonPath("$.readModel.months[0].actual.weeks[0].net").value(-1200000))
            .andExpect(jsonPath("$.readModel.months[0].actual.monthTotals.totalOut").value(1200000));
    }

    @Test
    void sameIdempotencyKeyWithDifferentBodyReturnsConflict() throws Exception {
        String first = """
            {
              "idempotencyKey": "idem-conflict",
              "rows": []
            }
            """;
        String second = first.replace("\"rows\": []", "\"rows\": [{\"rowIndex\": 0, \"cells\": []}]");

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-b/sheets/default/save-draft"), "tenant-b", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(first))
            .andExpect(status().isOk());

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-b/sheets/default/save-draft"), "tenant-b", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(second))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("weekly_expense_conflict"));
    }

    @Test
    void saveDraftDoesNotPersistActualsForRowsRequiringReview() throws Exception {
        String body = """
            {
              "idempotencyKey": "review-required-actual-001",
              "sheetName": "기본 탭",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "", "userEdited": true},
                    {"columnIndex": 13, "rawValue": "1,200,000", "userEdited": true}
                  ]
                }
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-review/sheets/default/save-draft"), "tenant-review", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.cellIssues[0].code").value("review_required"))
            .andExpect(jsonPath("$.actualDelta").isEmpty());

        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-review", "project-review")).isEmpty();
    }

    @Test
    void saveDraftActualFormulaUsesManualDepositAmountWithoutBankAmountFallback() throws Exception {
        String body = """
            {
              "idempotencyKey": "manual-deposit-actual-001",
              "sheetName": "기본 탭",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W2", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "매출액", "userEdited": true},
                    {"columnIndex": 11, "rawValue": "500,000", "userEdited": true}
                  ]
                }
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-manual-deposit/sheets/default/save-draft"), "tenant-manual-deposit", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.actualDelta[0].yearMonth").value("2026-06"))
            .andExpect(jsonPath("$.actualDelta[0].weekNo").value(2))
            .andExpect(jsonPath("$.actualDelta[0].cashflowLine").value("매출액"))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(500000));

        mockMvc.perform(asActor(get("/api/v1/cashflow/project-manual-deposit"), "tenant-manual-deposit", "viewer-manual-deposit", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.readModel.months[0].actual.rowTotals.SALES_IN").value(500000))
            .andExpect(jsonPath("$.readModel.months[0].actual.weeks[0].totalIn").value(500000))
            .andExpect(jsonPath("$.readModel.months[0].actual.weeks[0].net").value(500000));
    }

    @Test
    void upsertProjectionPersistsBackendProjectionLines() throws Exception {
        String body = """
            {
              "idempotencyKey": "projection-001",
              "lines": [
                {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "사업비", "amount": 3000000}
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/cashflow/project-projection/projection"), "tenant-projection", "finance-1", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.projection.upsert"))
            .andExpect(jsonPath("$.savedLineCount").value(1))
            .andExpect(jsonPath("$.projection[0].amount").value(3000000));

        mockMvc.perform(asActor(get("/api/v1/cashflow/project-projection"), "tenant-projection", "viewer-projection", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.projection[0].cashflowLine").value("사업비"))
            .andExpect(jsonPath("$.projection[0].amount").value(3000000))
            .andExpect(jsonPath("$.readModel.months[0].projection.rowTotals.DIRECT_COST_OUT").value(3000000))
            .andExpect(jsonPath("$.readModel.months[0].projection.weeks[0].weekOut").value(3000000))
            .andExpect(jsonPath("$.readModel.months[0].projection.monthTotals.net").value(-3000000));
    }

    @Test
    void cashflowSnapshotReadModelCanonicalizesAliasesAndMatchesRawProjectionActualTotals() throws Exception {
        String projection = """
            {
              "idempotencyKey": "read-model-projection-alias-001",
              "lines": [
                {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "사업비", "amount": 3000000},
                {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "DIRECT_COST_OUT", "amount": 700000},
                {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "매출액(입금)", "amount": 5000000},
                {"yearMonth": "2026-07", "weekNo": 1, "cashflowLine": "팀지원금(출금)", "amount": 400000}
              ]
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/cashflow/project-read-model/projection"), "tenant-read-model", "finance-read", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(projection))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.savedLineCount").value(4));

        String actual = """
            {
              "idempotencyKey": "read-model-actual-alias-001",
              "sheetName": "기본 탭",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "직접사업비(공급가액)+매입부가세", "userEdited": true},
                    {"columnIndex": 13, "rawValue": "1200000", "userEdited": true}
                  ]
                },
                {
                  "rowIndex": 1,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "SALES_IN", "userEdited": true},
                    {"columnIndex": 10, "rawValue": "2500000", "userEdited": true}
                  ]
                },
                {
                  "rowIndex": 2,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-07-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "은행이자(입금)", "userEdited": true},
                    {"columnIndex": 10, "rawValue": "9000", "userEdited": true}
                  ]
                }
              ]
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-read-model/sheets/default/save-draft"), "tenant-read-model", "pm-read", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(actual))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.actualDelta.length()").value(3));

        assertThat(projectionRepository.findByTenantIdAndProjectId("tenant-read-model", "project-read-model"))
            .hasSize(4);
        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-read-model", "project-read-model"))
            .hasSize(3);

        mockMvc.perform(asActor(get("/api/v1/cashflow/project-read-model"), "tenant-read-model", "viewer-read", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.projection.length()").value(4))
            .andExpect(jsonPath("$.actual.length()").value(3))
            .andExpect(jsonPath("$.readModel.months[0].yearMonth").value("2026-06"))
            .andExpect(jsonPath("$.readModel.months[0].projection.rowTotals.DIRECT_COST_OUT").value(3700000))
            .andExpect(jsonPath("$.readModel.months[0].projection.rowTotals.SALES_IN").value(5000000))
            .andExpect(jsonPath("$.readModel.months[0].projection.weeks[0].amounts.DIRECT_COST_OUT").value(3700000))
            .andExpect(jsonPath("$.readModel.months[0].projection.weeks[0].weekIn").value(5000000))
            .andExpect(jsonPath("$.readModel.months[0].projection.weeks[0].weekOut").value(3700000))
            .andExpect(jsonPath("$.readModel.months[0].projection.weeks[0].net").value(1300000))
            .andExpect(jsonPath("$.readModel.months[0].projection.monthTotals.totalIn").value(5000000))
            .andExpect(jsonPath("$.readModel.months[0].projection.monthTotals.totalOut").value(3700000))
            .andExpect(jsonPath("$.readModel.months[0].projection.monthTotals.net").value(1300000))
            .andExpect(jsonPath("$.readModel.months[0].actual.rowTotals.DIRECT_COST_OUT").value(1200000))
            .andExpect(jsonPath("$.readModel.months[0].actual.rowTotals.SALES_IN").value(2500000))
            .andExpect(jsonPath("$.readModel.months[0].actual.monthTotals.totalIn").value(2500000))
            .andExpect(jsonPath("$.readModel.months[0].actual.monthTotals.totalOut").value(1200000))
            .andExpect(jsonPath("$.readModel.months[0].actual.monthTotals.net").value(1300000))
            .andExpect(jsonPath("$.readModel.months[1].yearMonth").value("2026-07"))
            .andExpect(jsonPath("$.readModel.months[1].projection.monthTotals.totalOut").value(400000))
            .andExpect(jsonPath("$.readModel.months[1].projection.monthTotals.net").value(900000))
            .andExpect(jsonPath("$.readModel.months[1].actual.monthTotals.totalIn").value(9000))
            .andExpect(jsonPath("$.readModel.months[1].actual.monthTotals.net").value(1309000));
    }

    @Test
    void bankStatementUploadStagesLinesAndSelectedApplyCreatesWeeklyRowsActualAndAudit() throws Exception {
        String importBody = """
            {
              "idempotencyKey": "bank-import-001",
              "uploadName": "june-bank.xlsx",
              "columns": ["거래일시", "지급처", "적요", "금액", "잔액"],
              "lines": [
                {
                  "lineIndex": 0,
                  "sourceLineKey": "bank-line-20260601-001",
                  "transactionDate": "2026-06-01",
                  "counterparty": "테스트 지급처",
                  "memo": "시제품 제작비",
                  "signedAmount": -120000,
                  "balanceAfter": 880000,
                  "rawCells": ["2026-06-01", "테스트 지급처", "시제품 제작비", "-120000", "880000"]
                }
              ]
            }
            """;

        String importResponse = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank/bank-statements/import-batch"), "tenant-bank", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(importBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.bankStatement.importBatch"))
            .andExpect(jsonPath("$.stagedLineCount").value(1))
            .andExpect(jsonPath("$.duplicateLineCount").value(0))
            .andReturn()
            .getResponse()
            .getContentAsString();

        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-bank", "project-bank")).isEmpty();

        String lineId = objectMapper.readTree(importResponse).get("lines").get(0).get("id").asText();
        String applyBody = """
            {
              "idempotencyKey": "bank-apply-001",
              "sheetKey": "default",
              "sheetName": "기본 탭",
              "items": [
                {
                  "importLineId": "%s",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 5, "rawValue": "운영비", "userEdited": true},
                    {"columnIndex": 6, "rawValue": "제작비", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true}
                  ]
                }
              ]
            }
            """.formatted(lineId);

        String applyResponse = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank/bank-statements/apply-items"), "tenant-bank", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(applyBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.bankStatement.applyItems"))
            .andExpect(jsonPath("$.appliedLineCount").value(1))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(120000))
            .andReturn()
            .getResponse()
            .getContentAsString();

        assertThat(sheetRepository.findByTenantIdAndProjectIdAndSheetKey("tenant-bank", "project-bank", "default"))
            .isPresent();
        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-bank", "project-bank")).hasSize(1);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank/bank-statements/apply-items"), "tenant-bank", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(applyBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.auditId").value(objectMapper.readTree(applyResponse).get("auditId").asText()));
    }

    @Test
    void bankStatementImportStoresRaggedRawCellsAndListDefaultsToStagedCandidates() throws Exception {
        String importBody = """
            {
              "idempotencyKey": "bank-import-ragged-columns-001",
              "uploadName": "ragged-columns-bank.xlsx",
              "columns": ["거래일자", "적요", "출금금액", "잔액"],
              "lines": [
                {
                  "lineIndex": 0,
                  "sourceLineKey": "ragged-bank-line-short",
                  "transactionDate": "2026-06-05",
                  "counterparty": "짧은 행 지급처",
                  "memo": "rawCells가 columns보다 짧음",
                  "signedAmount": -10000,
                  "balanceAfter": 90000,
                  "rawCells": ["2026-06-05", "짧은 행"]
                },
                {
                  "lineIndex": 1,
                  "sourceLineKey": "ragged-bank-line-long",
                  "transactionDate": "2026-06-06",
                  "counterparty": "긴 행 지급처",
                  "memo": "rawCells가 columns보다 김",
                  "signedAmount": -20000,
                  "balanceAfter": 70000,
                  "rawCells": ["2026-06-06", "긴 행", "20,000", "70,000", "추가 은행 컬럼"]
                }
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-ragged/bank-statements/import-batch"), "tenant-bank-ragged", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(importBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stagedLineCount").value(2))
            .andExpect(jsonPath("$.duplicateLineCount").value(0));

        mockMvc.perform(asActor(get("/api/v1/weekly-expenses/project-bank-ragged/bank-statements/import-lines"), "tenant-bank-ragged", "viewer-bank", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("staged"))
            .andExpect(jsonPath("$.lines.length()").value(2))
            .andExpect(jsonPath("$.lines[0].sourceLineKey").value("ragged-bank-line-short"))
            .andExpect(jsonPath("$.lines[0].rawCells.length()").value(2))
            .andExpect(jsonPath("$.lines[1].sourceLineKey").value("ragged-bank-line-long"))
            .andExpect(jsonPath("$.lines[1].rawCells.length()").value(5))
            .andExpect(jsonPath("$.lines[1].rawCells[4]").value("추가 은행 컬럼"));
    }

    @Test
    void bankStatementImportRejectsOversizedColumnsRawCellsAndLineCountsBeforePersistence() throws Exception {
        List<String> tooManyColumns = new ArrayList<>();
        for (int i = 0; i < 81; i++) {
            tooManyColumns.add("은행컬럼" + i);
        }

        String tooManyColumnsBody = objectMapper.writeValueAsString(Map.of(
            "idempotencyKey", "bank-import-too-many-columns",
            "uploadName", "oversized-columns.xlsx",
            "columns", tooManyColumns,
            "lines", List.of(bankImportLine(0, "too-many-columns-line", List.of("2026-06-01", "-1")))
        ));

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-size/bank-statements/import-batch"), "tenant-bank-size", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(tooManyColumnsBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));

        List<String> tooManyRawCells = new ArrayList<>();
        for (int i = 0; i < 121; i++) {
            tooManyRawCells.add("cell-" + i);
        }
        String tooManyRawCellsBody = objectMapper.writeValueAsString(Map.of(
            "idempotencyKey", "bank-import-too-many-raw-cells",
            "uploadName", "oversized-raw-cells.xlsx",
            "columns", List.of("거래일자", "금액"),
            "lines", List.of(bankImportLine(0, "too-many-raw-cells-line", tooManyRawCells))
        ));

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-size/bank-statements/import-batch"), "tenant-bank-size", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(tooManyRawCellsBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));

        List<Map<String, Object>> tooManyLines = new ArrayList<>();
        for (int i = 0; i < 2001; i++) {
            tooManyLines.add(bankImportLine(i, "too-many-lines-" + i, List.of("2026-06-01", "-1")));
        }
        String tooManyLinesBody = objectMapper.writeValueAsString(Map.of(
            "idempotencyKey", "bank-import-too-many-lines",
            "uploadName", "oversized-lines.xlsx",
            "columns", List.of("거래일자", "금액"),
            "lines", tooManyLines
        ));

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-size/bank-statements/import-batch"), "tenant-bank-size", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(tooManyLinesBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));

        assertThat(bankImportLineRepository.findByTenantIdAndProjectIdAndOptionalStatus("tenant-bank-size", "project-bank-size", null))
            .isEmpty();
    }

    @Test
    void bankStatementImportDeduplicatesAndApplyRejectsAlreadyAppliedLinesWithNewIdempotencyKey() throws Exception {
        String importBody = """
            {
              "idempotencyKey": "bank-import-dedupe-001",
              "uploadName": "dedupe-bank.xlsx",
              "columns": ["거래일시", "지급처", "적요", "금액", "잔액"],
              "lines": [
                {
                  "lineIndex": 0,
                  "sourceLineKey": "dup-bank-line-001",
                  "transactionDate": "2026-06-03",
                  "counterparty": "선택 지급처",
                  "memo": "선택 적용",
                  "signedAmount": -100000,
                  "balanceAfter": 900000,
                  "rawCells": ["2026-06-03", "선택 지급처", "선택 적용", "-100000", "900000"]
                },
                {
                  "lineIndex": 1,
                  "sourceLineKey": "dup-bank-line-001",
                  "transactionDate": "2026-06-03",
                  "counterparty": "중복 지급처",
                  "memo": "같은 업로드 내 중복",
                  "signedAmount": -200000,
                  "balanceAfter": 700000,
                  "rawCells": ["2026-06-03", "중복 지급처", "같은 업로드 내 중복", "-200000", "700000"]
                },
                {
                  "lineIndex": 2,
                  "sourceLineKey": "dup-bank-line-002",
                  "transactionDate": "2026-06-04",
                  "counterparty": "보류 지급처",
                  "memo": "아직 적용하지 않음",
                  "signedAmount": -300000,
                  "balanceAfter": 400000,
                  "rawCells": ["2026-06-04", "보류 지급처", "아직 적용하지 않음", "-300000", "400000"]
                }
              ]
            }
            """;

        String importResponse = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-dedupe/bank-statements/import-batch"), "tenant-bank-dedupe", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(importBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stagedLineCount").value(2))
            .andExpect(jsonPath("$.duplicateLineCount").value(1))
            .andExpect(jsonPath("$.lines.length()").value(3))
            .andReturn()
            .getResponse()
            .getContentAsString();

        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-bank-dedupe", "project-bank-dedupe"))
            .isEmpty();

        String existingDuplicateBody = """
            {
              "idempotencyKey": "bank-import-dedupe-002",
              "uploadName": "dedupe-bank-retry.xlsx",
              "columns": ["거래일시", "지급처", "적요", "금액", "잔액"],
              "lines": [
                {
                  "lineIndex": 0,
                  "sourceLineKey": "dup-bank-line-001",
                  "transactionDate": "2026-06-03",
                  "counterparty": "선택 지급처",
                  "memo": "이미 staged",
                  "signedAmount": -100000,
                  "balanceAfter": 900000,
                  "rawCells": ["2026-06-03", "선택 지급처", "이미 staged", "-100000", "900000"]
                }
              ]
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-dedupe/bank-statements/import-batch"), "tenant-bank-dedupe", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(existingDuplicateBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.stagedLineCount").value(0))
            .andExpect(jsonPath("$.duplicateLineCount").value(1));

        JsonNode lines = objectMapper.readTree(importResponse).get("lines");
        String selectedLineId = null;
        String unselectedLineId = null;
        for (JsonNode line : lines) {
            if ("dup-bank-line-001".equals(line.get("sourceLineKey").asText()) && !line.get("id").isNull()) {
                selectedLineId = line.get("id").asText();
            }
            if ("dup-bank-line-002".equals(line.get("sourceLineKey").asText()) && !line.get("id").isNull()) {
                unselectedLineId = line.get("id").asText();
            }
        }
        assertThat(selectedLineId).isNotBlank();
        assertThat(unselectedLineId).isNotBlank();

        String applySelected = """
            {
              "idempotencyKey": "bank-apply-dedupe-001",
              "sheetKey": "default",
              "sheetName": "기본 탭",
              "items": [
                {
                  "importLineId": "%s",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true}
                  ]
                }
              ]
            }
            """.formatted(selectedLineId);

        String duplicateApplySelected = """
            {
              "idempotencyKey": "bank-apply-duplicate-items-001",
              "sheetKey": "default",
              "sheetName": "기본 탭",
              "items": [
                {
                  "importLineId": "%s",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true}
                  ]
                },
                {
                  "importLineId": "%s",
                  "cells": [
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true}
                  ]
                }
              ]
            }
            """.formatted(selectedLineId, selectedLineId);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-dedupe/bank-statements/apply-items"), "tenant-bank-dedupe", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(duplicateApplySelected))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_bad_request"));

        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-bank-dedupe", "project-bank-dedupe"))
            .isEmpty();

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-dedupe/bank-statements/apply-items"), "tenant-bank-dedupe", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(applySelected))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.appliedLineCount").value(1))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(100000));

        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-bank-dedupe", "project-bank-dedupe"))
            .hasSize(1);
        assertThat(bankImportLineRepository.findById(selectedLineId).orElseThrow().getStatus())
            .isEqualTo("applied");
        assertThat(bankImportLineRepository.findById(unselectedLineId).orElseThrow().getStatus())
            .isEqualTo("staged");

        mockMvc.perform(asActor(get("/api/v1/weekly-expenses/project-bank-dedupe/bank-statements/import-lines"), "tenant-bank-dedupe", "viewer-bank", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("staged"))
            .andExpect(jsonPath("$.lines.length()").value(1))
            .andExpect(jsonPath("$.lines[0].id").value(unselectedLineId))
            .andExpect(jsonPath("$.lines[0].status").value("staged"))
            .andExpect(jsonPath("$.lines[0].rawCells[0]").value("2026-06-04"));

        mockMvc.perform(asActor(get("/api/v1/weekly-expenses/project-bank-dedupe/bank-statements/import-lines?status=all"), "tenant-bank-dedupe", "finance-bank", "finance"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("all"))
            .andExpect(jsonPath("$.lines.length()").value(2))
            .andExpect(jsonPath("$.lines[0].batchId").isNotEmpty())
            .andExpect(jsonPath("$.lines[0].uploadName").value("dedupe-bank.xlsx"));

        String reapplySelected = applySelected.replace("bank-apply-dedupe-001", "bank-apply-dedupe-002");
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bank-dedupe/bank-statements/apply-items"), "tenant-bank-dedupe", "pm-bank", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(reapplySelected))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("weekly_expense_conflict"))
            .andExpect(jsonPath("$.message").value("Bank import line is already applied: " + selectedLineId));

        assertThat(actualRepository.findByTenantIdAndProjectId("tenant-bank-dedupe", "project-bank-dedupe"))
            .hasSize(1);
    }

    @Test
    void submitWeekPersistsStateAuditAndIdempotency() throws Exception {
        String body = """
            {
              "idempotencyKey": "submit-001",
              "yearMonth": "2026-06",
              "weekNo": 2
            }
            """;

        String firstResponse = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-submit/submit"), "tenant-submit", "pm-submit", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.submitWeek"))
            .andExpect(jsonPath("$.state").value("submitted"))
            .andReturn()
            .getResponse()
            .getContentAsString();

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-submit/submit"), "tenant-submit", "pm-submit", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.auditId").value(objectMapper.readTree(firstResponse).get("auditId").asText()));
    }

    @Test
    void closeWeekPersistsStateAuditAndRequiresSubmittedWeek() throws Exception {
        String closeBeforeSubmitBody = """
            {
              "idempotencyKey": "close-before-submit-001",
              "yearMonth": "2026-06",
              "weekNo": 3
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-close/close"), "tenant-close", "admin-close", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(closeBeforeSubmitBody))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("weekly_expense_conflict"));

        String submitBody = """
            {
              "idempotencyKey": "submit-before-close-001",
              "yearMonth": "2026-06",
              "weekNo": 3
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-close/submit"), "tenant-close", "pm-close", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(submitBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("submitted"));

        String closeBody = """
            {
              "idempotencyKey": "close-001",
              "yearMonth": "2026-06",
              "weekNo": 3
            }
            """;
        String firstResponse = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-close/close"), "tenant-close", "admin-close", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(closeBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.closeWeek"))
            .andExpect(jsonPath("$.state").value("closed"))
            .andReturn()
            .getResponse()
            .getContentAsString();

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-close/close"), "tenant-close", "admin-close", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(closeBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.auditId").value(objectMapper.readTree(firstResponse).get("auditId").asText()));

        mockMvc.perform(asActor(get("/api/v1/weekly-expenses/project-close/statuses"), "tenant-close", "viewer-close", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.projectId").value("project-close"))
            .andExpect(jsonPath("$.statuses.length()").value(1))
            .andExpect(jsonPath("$.statuses[0].id").value("project-close-2026-06-w3"))
            .andExpect(jsonPath("$.statuses[0].state").value("closed"))
            .andExpect(jsonPath("$.statuses[0].pmSubmitted").value(true))
            .andExpect(jsonPath("$.statuses[0].submittedBy").value("pm-close"))
            .andExpect(jsonPath("$.statuses[0].adminClosed").value(true))
            .andExpect(jsonPath("$.statuses[0].closedBy").value("admin-close"));

        mockMvc.perform(asActor(get("/api/v1/weekly-expenses/project-close/statuses"), "tenant-close", "contractor-close", "contractor"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("weekly_expense_forbidden"));
    }

    @Test
    void projectionWriteRejectsViewerRole() throws Exception {
        String body = """
            {
              "idempotencyKey": "projection-viewer",
              "lines": [
                {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "사업비", "amount": 3000000}
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/cashflow/project-auth/projection"), "tenant-auth", "viewer-1", "viewer")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("weekly_expense_forbidden"));
    }

    @Test
    void projectionWriteRejectsMalformedLineBeforePersistence() throws Exception {
        String body = """
            {
              "idempotencyKey": "projection-malformed-001",
              "lines": [
                {"yearMonth": "2026-0X", "weekNo": 1, "cashflowLine": "사업비", "amount": 3000000}
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/cashflow/project-projection-bounds/projection"), "tenant-projection-bounds", "finance-1", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));

        assertThat(projectionRepository.findByTenantIdAndProjectId("tenant-projection-bounds", "project-projection-bounds"))
            .isEmpty();
    }

    @Test
    void submitAndCloseRejectMalformedYearMonthBeforePersistence() throws Exception {
        String submitBody = """
            {
              "idempotencyKey": "submit-malformed-month-001",
              "yearMonth": "2026-0X",
              "weekNo": 1
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-status-bounds/submit"), "tenant-status-bounds", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(submitBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));

        String closeBody = """
            {
              "idempotencyKey": "close-malformed-month-001",
              "yearMonth": "2026-0X",
              "weekNo": 1
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-status-bounds/close"), "tenant-status-bounds", "finance-1", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(closeBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));
    }

    @Test
    void auditExportRejectsOversizedIdempotencyKeyBeforePersistence() throws Exception {
        String oversizedKey = "x".repeat(WeeklyExpenseRequestLimits.MAX_IDEMPOTENCY_KEY_LENGTH + 1);
        String body = """
            {
              "idempotencyKey": "%s",
              "format": "CSV",
              "includeAuditSummary": true
            }
            """.formatted(oversizedKey);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-export-bounds/audit-export"), "tenant-export-bounds", "finance-1", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));
    }

    @Test
    void commandBodyRejectsClientSuppliedActorAndTenantFields() throws Exception {
        String body = """
            {
              "tenantId": "spoofed-tenant",
              "idempotencyKey": "spoofed-body-001",
              "actor": {"id": "spoofed-admin", "role": "admin"},
              "rows": []
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-spoof/sheets/default/save-draft"), "tenant-spoof", "pm-1", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_invalid_json"));
    }

    @Test
    void writeCommandsRejectOffSchemaCellsAndNonRectangularPasteBeforeOrmPersistence() throws Exception {
        String offSchemaSave = """
            {
              "idempotencyKey": "off-schema-save-001",
              "sheetName": "기본 탭",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 20, "rawValue": "outside schema", "userEdited": true}
                  ]
                }
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bounds/sheets/default/save-draft"), "tenant-bounds", "pm-bounds", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(offSchemaSave))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));

        String sparsePaste = """
            {
              "idempotencyKey": "sparse-paste-001",
              "anchorRow": 0,
              "anchorColumn": 0,
              "rowCount": 1,
              "columnCount": 2,
              "depth": "SHALLOW",
              "cells": [
                {"relativeRow": 0, "relativeColumn": 0, "rawValue": "2026-06-W1"}
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bounds/sheets/default/commands/paste"), "tenant-bounds", "pm-bounds", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sparsePaste))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_bad_request"));

        String overflowInsert = """
            {
              "idempotencyKey": "overflow-insert-001",
              "startRow": 1999,
              "rowCount": 2
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-bounds/sheets/default/commands/row-insert"), "tenant-bounds", "pm-bounds", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(overflowInsert))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_bad_request"));

        assertThat(sheetRepository.findByTenantIdAndProjectIdAndSheetKey("tenant-bounds", "project-bounds", "default"))
            .isEmpty();

        String sparseHighRow = """
            {
              "idempotencyKey": "sparse-high-row-001",
              "sheetName": "기본 탭",
              "rows": [
                {
                  "rowIndex": 1999,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true}
                  ]
                }
              ]
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-row-overflow/sheets/default/save-draft"), "tenant-row-overflow", "pm-bounds", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sparseHighRow))
            .andExpect(status().isOk());

        long sparseVersion = sheetRepository
            .findByTenantIdAndProjectIdAndSheetKey("tenant-row-overflow", "project-row-overflow", "default")
            .orElseThrow()
            .getSheetVersion();
        String sparseOverflowInsert = """
            {
              "idempotencyKey": "sparse-overflow-insert-001",
              "expectedSheetVersion": %d,
              "startRow": 1990,
              "rowCount": 10
            }
            """.formatted(sparseVersion);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-row-overflow/sheets/default/commands/row-insert"), "tenant-row-overflow", "pm-bounds", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sparseOverflowInsert))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_bad_request"));
    }

    private static Map<String, Object> bankImportLine(int lineIndex, String sourceLineKey, List<String> rawCells) {
        return Map.of(
            "lineIndex", lineIndex,
            "sourceLineKey", sourceLineKey,
            "transactionDate", "2026-06-01",
            "counterparty", "validation-target",
            "memo", "oversized boundary test",
            "signedAmount", -1,
            "balanceAfter", 0,
            "rawCells", rawCells
        );
    }

    @Test
    void patchPasteAndCutCellsAreAuditedBackendCommands() throws Exception {
        String patch = """
            {
              "idempotencyKey": "patch-001",
              "sheetName": "기본 탭",
              "cells": [
                {"rowIndex": 0, "columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                {"rowIndex": 0, "columnIndex": 8, "rawValue": "사업비", "userEdited": true},
                {"rowIndex": 0, "columnIndex": 13, "rawValue": "1000", "userEdited": true}
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-cells/sheets/default/commands/cell-patch"), "tenant-cells", "pm-cells", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(patch))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.cell.patch"))
            .andExpect(jsonPath("$.touchedCellCount").value(3))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(1000));

        long versionAfterPatch = sheetRepository
            .findByTenantIdAndProjectIdAndSheetKey("tenant-cells", "project-cells", "default")
            .orElseThrow()
            .getSheetVersion();

        String copy = """
            {
              "idempotencyKey": "copy-001",
              "expectedSheetVersion": %d,
              "startRow": 0,
              "startColumn": 3,
              "endRow": 0,
              "endColumn": 13,
              "depth": "DEEP"
            }
            """.formatted(versionAfterPatch);

        String copyResponse = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-cells/sheets/default/commands/copy"), "tenant-cells", "pm-cells", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(copy))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.cells.copy"))
            .andExpect(jsonPath("$.touchedCellCount").value(11))
            .andExpect(jsonPath("$.actualDelta").isEmpty())
            .andExpect(jsonPath("$.clipboard.operationType").value("COPY"))
            .andExpect(jsonPath("$.clipboard.depth").value("DEEP"))
            .andExpect(jsonPath("$.clipboard.rowCount").value(1))
            .andExpect(jsonPath("$.clipboard.columnCount").value(11))
            .andExpect(jsonPath("$.clipboard.cells[0].relativeRow").value(0))
            .andExpect(jsonPath("$.clipboard.cells[0].relativeColumn").value(0))
            .andReturn()
            .getResponse()
            .getContentAsString();

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-cells/sheets/default/commands/copy"), "tenant-cells", "pm-cells", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(copy))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.auditId").value(objectMapper.readTree(copyResponse).get("auditId").asText()));

        long versionAfterCopy = sheetRepository
            .findByTenantIdAndProjectIdAndSheetKey("tenant-cells", "project-cells", "default")
            .orElseThrow()
            .getSheetVersion();
        assertThat(versionAfterCopy).isEqualTo(versionAfterPatch);

        String paste = """
            {
              "idempotencyKey": "paste-001",
              "expectedSheetVersion": %d,
              "anchorRow": 1,
              "anchorColumn": 3,
              "rowCount": 1,
              "columnCount": 11,
              "depth": "SHALLOW",
              "cells": [
                {"relativeRow": 0, "relativeColumn": 0, "rawValue": "2026-06-W1"},
                {"relativeRow": 0, "relativeColumn": 1, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 2, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 3, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 4, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 5, "rawValue": "사업비"},
                {"relativeRow": 0, "relativeColumn": 6, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 7, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 8, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 9, "rawValue": ""},
                {"relativeRow": 0, "relativeColumn": 10, "rawValue": "2000"}
              ]
            }
            """.formatted(versionAfterCopy);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-cells/sheets/default/commands/paste"), "tenant-cells", "pm-cells", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(paste))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.cells.paste"))
            .andExpect(jsonPath("$.touchedCellCount").value(11))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(3000));

        long versionAfterPaste = sheetRepository
            .findByTenantIdAndProjectIdAndSheetKey("tenant-cells", "project-cells", "default")
            .orElseThrow()
            .getSheetVersion();

        String cut = """
            {
              "idempotencyKey": "cut-001",
              "expectedSheetVersion": %d,
              "startRow": 1,
              "startColumn": 13,
              "endRow": 1,
              "endColumn": 13,
              "depth": "SHALLOW"
            }
            """.formatted(versionAfterPaste);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-cells/sheets/default/commands/cut"), "tenant-cells", "pm-cells", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(cut))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.cells.cut"))
            .andExpect(jsonPath("$.clipboard.operationType").value("CUT"))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(1000));
    }

    @Test
    void rowInsertAndDeleteAreAuditedBackendCommandsWithVersionChecks() throws Exception {
        String patch = """
            {
              "idempotencyKey": "rows-patch-001",
              "sheetName": "기본 탭",
              "cells": [
                {"rowIndex": 0, "columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                {"rowIndex": 0, "columnIndex": 8, "rawValue": "사업비", "userEdited": true},
                {"rowIndex": 0, "columnIndex": 13, "rawValue": "1000", "userEdited": true}
              ]
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-rows/sheets/default/commands/cell-patch"), "tenant-rows", "pm-rows", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(patch))
            .andExpect(status().isOk());

        long versionAfterPatch = sheetRepository
            .findByTenantIdAndProjectIdAndSheetKey("tenant-rows", "project-rows", "default")
            .orElseThrow()
            .getSheetVersion();

        String insert = """
            {
              "idempotencyKey": "row-insert-001",
              "expectedSheetVersion": %d,
              "sheetName": "기본 탭",
              "startRow": 0,
              "rowCount": 1
            }
            """.formatted(versionAfterPatch);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-rows/sheets/default/commands/row-insert"), "tenant-rows", "pm-rows", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(insert))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.row.insert"))
            .andExpect(jsonPath("$.affectedRowCount").value(1))
            .andExpect(jsonPath("$.actualDelta[0].amount").value(1000));

        var sheet = sheetRepository.findWithRowsByTenantIdAndProjectIdAndSheetKey("tenant-rows", "project-rows", "default")
            .orElseThrow();
        long shiftedRowVersion = sheet.findRow(1).orElseThrow().getRowVersion();

        String deleteWithoutVersion = """
            {
              "idempotencyKey": "row-delete-missing-version",
              "startRow": 1,
              "rowCount": 1
            }
            """;

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-rows/sheets/default/commands/row-delete"), "tenant-rows", "pm-rows", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(deleteWithoutVersion))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("weekly_expense_conflict"));

        String delete = """
            {
              "idempotencyKey": "row-delete-001",
              "expectedSheetVersion": %d,
              "startRow": 1,
              "rowCount": 1,
              "expectedRowVersions": [
                {"rowIndex": 1, "rowVersion": %d}
              ]
            }
            """.formatted(sheet.getSheetVersion(), shiftedRowVersion);

        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-rows/sheets/default/commands/row-delete"), "tenant-rows", "pm-rows", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(delete))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.row.delete"))
            .andExpect(jsonPath("$.affectedRowCount").value(1));
    }

    @Test
    void auditExportCreatesHashAddressedCsvFromProjectionActualAndAuditSummary() throws Exception {
        String projection = """
            {
              "idempotencyKey": "export-projection-001",
              "lines": [
                {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "사업비", "amount": 3000000}
              ]
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/cashflow/project-export/projection"), "tenant-export", "finance-export", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(projection))
            .andExpect(status().isOk());

        String actual = """
            {
              "idempotencyKey": "export-actual-001",
              "sheetName": "기본 탭",
              "rows": [
                {
                  "rowIndex": 0,
                  "entryKind": "manual",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true},
                    {"columnIndex": 13, "rawValue": "1200000", "userEdited": true}
                  ]
                }
              ]
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-export/sheets/default/save-draft"), "tenant-export", "pm-export", "pm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(actual))
            .andExpect(status().isOk());

        String exportBody = """
            {
              "idempotencyKey": "audit-export-001",
              "format": "CSV",
              "includeAuditSummary": true
            }
            """;

        String response = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-export/audit-export"), "tenant-export", "finance-export", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(exportBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.auditExport.create"))
            .andExpect(jsonPath("$.artifactType").value("CSV"))
            .andExpect(jsonPath("$.fileName").value("project-export-weekly-expense-audit.csv"))
            .andExpect(jsonPath("$.projectionLineCount").value(1))
            .andExpect(jsonPath("$.actualLineCount").value(1))
            .andExpect(jsonPath("$.auditEventCount").value(2))
            .andReturn()
            .getResponse()
            .getContentAsString();

        JsonNode json = objectMapper.readTree(response);
        assertThat(json.get("sha256").asText()).hasSize(64);
        assertThat(json.get("content").asText())
            .contains("PROJECTION,project-export,2026-06,1,,")
            .contains("ACTUAL,project-export,2026-06,1,default,")
            .contains("AUDIT_SUMMARY,project-export");
        assertThat(auditExportRepository.findById(json.get("artifactId").asText())).isPresent();
        assertThat(auditEventRepository.findAll().stream()
            .anyMatch(event -> "weeklyExpense.auditExport.create".equals(event.getCommandName()))).isTrue();
    }

    @Test
    void auditExportPrefixesFormulaLikeCsvCellsBeforeExternalOutput() throws Exception {
        String projection = """
            {
              "idempotencyKey": "formula-projection-001",
              "lines": [
                {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "=HYPERLINK(\\"https://example.com\\")", "amount": 1000}
              ]
            }
            """;
        mockMvc.perform(asActor(post("/api/v1/cashflow/project-formula-export/projection"), "tenant-formula-export", "finance-formula", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(projection))
            .andExpect(status().isOk());

        String exportBody = """
            {
              "idempotencyKey": "formula-audit-export-001",
              "format": "CSV",
              "includeAuditSummary": true
            }
            """;

        String response = mockMvc.perform(asActor(post("/api/v1/weekly-expenses/project-formula-export/audit-export"), "tenant-formula-export", "finance-formula", "finance")
                .contentType(MediaType.APPLICATION_JSON)
                .content(exportBody))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();

        String content = objectMapper.readTree(response).get("content").asText();
        assertThat(content).contains(",\"'=HYPERLINK(\"\"https://example.com\"\")\"");
        assertThat(content).doesNotContain(",=HYPERLINK(");
    }
}
