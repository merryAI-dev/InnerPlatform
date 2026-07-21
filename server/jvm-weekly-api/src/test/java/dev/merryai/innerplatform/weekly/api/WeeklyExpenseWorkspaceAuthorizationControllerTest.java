package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseAuditEventRepository;
import dev.merryai.innerplatform.weekly.storage.JpaWeeklyExpensePersistence;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "weekly.auth-mode=internal_saas_workspace")
class WeeklyExpenseWorkspaceAuthorizationControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WeeklyExpenseAuditEventRepository auditEventRepository;

    @SpyBean
    private JpaWeeklyExpensePersistence weeklyExpensePersistence;

    @BeforeEach
    void allowLegacyJpaFixtureWritesWithoutFirestoreLeaseBackend() {
        doAnswer(invocation -> ((TrustedActorContext) invocation.getArgument(0)).role())
            .when(weeklyExpensePersistence).requireCashflowWriteLease(any(), any(), any());
        doAnswer(invocation -> ((TrustedActorContext) invocation.getArgument(0)).role())
            .when(weeklyExpensePersistence).requireCashflowWritePermission(any(), any());
        doNothing().when(weeklyExpensePersistence).requireCashflowMonthsOpen(any(), any(), any());
    }

    @Test
    void myscWorkspaceUserCanImportApplyProjectCashflowAndAuditWithoutRoleGate() throws Exception {
        String importBody = """
            {
              "idempotencyKey": "workspace-import-001",
              "uploadName": "stage-upload",
              "columns": ["거래일시", "거래처", "출금액", "잔액"],
              "lines": [
                {
                  "lineIndex": 0,
                  "sourceLineKey": "workspace-line-001",
                  "transactionDate": "2026-06-03",
                  "counterparty": "Amazon_AWS",
                  "memo": "",
                  "signedAmount": -11000,
                  "balanceAfter": 100000,
                  "rawCells": ["2026-06-03 10:00:00", "Amazon_AWS", "11000", "100000"]
                }
              ]
            }
            """;

        String importResponse = mockMvc.perform(workspaceActor(post("/api/v1/weekly-expenses/project-workspace/bank-statements/import-batch"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(importBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("weeklyExpense.bankStatement.importBatch"))
            .andReturn()
            .getResponse()
            .getContentAsString();
        String importLineId = com.jayway.jsonpath.JsonPath.read(importResponse, "$.lines[0].id");

        String applyBody = """
            {
              "idempotencyKey": "workspace-apply-001",
              "sheetKey": "default",
              "sheetName": "기본 탭",
              "items": [
                {
                  "importLineId": "%s",
                  "cells": [
                    {"columnIndex": 3, "rawValue": "2026-06-W1", "userEdited": true},
                    {"columnIndex": 8, "rawValue": "사업비", "userEdited": true},
                    {"columnIndex": 13, "rawValue": "11000", "userEdited": true}
                  ]
                }
              ]
            }
            """.formatted(importLineId);

        mockMvc.perform(workspaceActor(post("/api/v1/weekly-expenses/project-workspace/bank-statements/apply-items"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(applyBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.appliedLineCount").value(1));

        mockMvc.perform(workspaceActor(post("/api/v1/cashflow/project-workspace/projection"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "workspace-projection-001",
                      "lines": [
                        {"yearMonth": "2026-06", "weekNo": 1, "cashflowLine": "사업비", "amount": 11000}
                      ]
                    }
                    """))
            .andExpect(status().isOk());

        mockMvc.perform(workspaceActor(get("/api/v1/cashflow/project-workspace")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.readModel.months[0].actual.monthTotals.totalOut").value(11000));

        mockMvc.perform(workspaceActor(post("/api/v1/weekly-expenses/project-workspace/audit-export"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "workspace-audit-export-001",
                      "format": "CSV",
                      "includeAuditSummary": true
                    }
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.content").value(org.hamcrest.Matchers.containsString("workspace-user@mysc.co.kr")))
            .andExpect(jsonPath("$.content").value(org.hamcrest.Matchers.containsString("Workspace User")));

        mockMvc.perform(workspaceActor(get("/api/v1/weekly-expenses/project-workspace/sheets")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.recentAuditEvents[0].actorRole").value("workspace_user"))
            .andExpect(jsonPath("$.recentAuditEvents[0].actorEmail").value("workspace-user@mysc.co.kr"))
            .andExpect(jsonPath("$.recentAuditEvents[0].actorName").value("Workspace User"));

        assertThat(auditEventRepository.findByTenantIdAndProjectIdOrderByCreatedAtAsc("tenant-workspace", "project-workspace"))
            .extracting("actorRole")
            .containsOnly("workspace_user");
    }

    @Test
    void workspaceModeRejectsNonMyscGoogleAccount() throws Exception {
        mockMvc.perform(nonMyscActor(post("/api/v1/weekly-expenses/project-workspace/sheets/default/save-draft"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"idempotencyKey\":\"non-mysc-denied\",\"sheetName\":\"기본 탭\",\"rows\":[]}"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("workspace_email_domain_required"));
    }

    @Test
    void workspaceModeRejectsHeaderEmailWhenFirebaseTokenHasNoVerifiedEmail() throws Exception {
        mockMvc.perform(noEmailActorWithSpoofedHeader(post("/api/v1/weekly-expenses/project-workspace/bank-statements/import-batch"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "workspace-spoofed-email-001",
                      "uploadName": "spoofed-upload",
                      "columns": ["거래일시", "거래처", "출금액"],
                      "lines": []
                    }
                    """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("workspace_email_domain_required"));
    }

    private static MockHttpServletRequestBuilder workspaceActor(MockHttpServletRequestBuilder request) {
        return request
            .header("authorization", "Bearer " + firebaseTestToken("tenant-workspace", "workspace-user", "viewer", "workspace-user@mysc.co.kr", "Workspace User"))
            .header("x-tenant-id", "tenant-workspace")
            .header("x-data-project-id", "test-data-project")
            .header("x-edit-session-id", "test-session")
            .header("x-edit-lease-id", "test-lease")
            .header("x-edit-fence", "1");
    }

    private static MockHttpServletRequestBuilder nonMyscActor(MockHttpServletRequestBuilder request) {
        return request
            .header("authorization", "Bearer " + firebaseTestToken("tenant-workspace", "external-user", "viewer", "external@example.com", "External User"))
            .header("x-tenant-id", "tenant-workspace");
    }

    private static MockHttpServletRequestBuilder noEmailActorWithSpoofedHeader(MockHttpServletRequestBuilder request) {
        return request
            .header("authorization", "Bearer " + firebaseTestToken("tenant-workspace", "no-email-user", "viewer", "", "No Email User"))
            .header("x-tenant-id", "tenant-workspace")
            .header("x-actor-email", "spoofed@mysc.co.kr");
    }

    private static String firebaseTestToken(String tenantId, String actorId, String role, String email, String name) {
        String claims = "uid=%s;tenantId=%s;role=%s;email=%s;name=%s".formatted(actorId, tenantId, role, email, name);
        return "test-firebase:" + Base64.getUrlEncoder().encodeToString(claims.getBytes(StandardCharsets.UTF_8));
    }
}
