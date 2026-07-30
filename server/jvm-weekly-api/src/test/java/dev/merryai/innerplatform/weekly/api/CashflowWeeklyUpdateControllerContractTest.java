package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CashflowWeeklyUpdateControllerContractTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WeeklyExpenseCommandService commandService;

    @BeforeEach
    void stubWeeklySettlementResponses() {
        when(commandService.readCashflowWeeklyUpdate(any(), eq("project-a"), eq("2026-06"), eq(2)))
            .thenReturn(lockedResponse("cashflowWeeklyUpdate.read"));
        when(commandService.completeCashflowWeeklyUpdate(eqActor("viewer-1"), eq("project-a"), any()))
            .thenReturn(lockedResponse("cashflowWeeklyUpdate.complete"));
        when(commandService.reopenCashflowWeeklyUpdate(eqActor("viewer-1"), eq("project-a"), any()))
            .thenReturn(openResponse());
    }

    @Test
    void mapsReadCompleteAndReopenWithoutEditLeaseHeaders() throws Exception {
        mockMvc.perform(asViewer(get("/api/v1/cashflow/project-a/weekly-update-complete")
                .queryParam("yearMonth", "2026-06")
                .queryParam("weekNo", "2")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("LOCKED"))
            .andExpect(jsonPath("$.revision").value(1));

        mockMvc.perform(asViewer(post("/api/v1/cashflow/project-a/weekly-update-complete"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "weekly-complete-http",
                      "yearMonth": "2026-06",
                      "weekNo": 2,
                      "completedAt": "2026-07-09T15:00:00Z",
                      "updateResult": "CHANGED"
                    }
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commandName").value("cashflowWeeklyUpdate.complete"));

        mockMvc.perform(asViewer(post("/api/v1/cashflow/project-a/weekly-update-complete/reopen"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "weekly-reopen-http",
                      "yearMonth": "2026-06",
                      "weekNo": 2,
                      "expectedRevision": 1,
                      "reason": "긴급 증빙 정정"
                    }
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("OPEN"))
            .andExpect(jsonPath("$.revision").value(2));

        verify(commandService).readCashflowWeeklyUpdate(any(), eq("project-a"), eq("2026-06"), eq(2));
        verify(commandService).completeCashflowWeeklyUpdate(eqActor("viewer-1"), eq("project-a"), any());
        verify(commandService).reopenCashflowWeeklyUpdate(eqActor("viewer-1"), eq("project-a"), any());
    }

    @Test
    void rejectsInvalidReadAndMutationScopesBeforeTheService() throws Exception {
        mockMvc.perform(asViewer(get("/api/v1/cashflow/project-a/weekly-update-complete")
                .queryParam("yearMonth", "2026-13")
                .queryParam("weekNo", "6")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_bad_request"));

        mockMvc.perform(asViewer(post("/api/v1/cashflow/project-a/weekly-update-complete"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "weekly-invalid-http",
                      "yearMonth": "2026-13",
                      "weekNo": 6,
                      "completedAt": "",
                      "updateResult": "NO_CHANGES"
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));

        mockMvc.perform(asViewer(post("/api/v1/cashflow/project-a/weekly-update-complete/reopen"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "weekly-reopen-invalid-http",
                      "yearMonth": "2026-06",
                      "weekNo": 2,
                      "expectedRevision": 0,
                      "reason": ""
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_validation_failed"));
    }

    @Test
    void mapsAWeeklyLockConflictToHttp409() throws Exception {
        when(commandService.completeCashflowWeeklyUpdate(any(), eq("project-conflict"), any()))
            .thenThrow(new WeeklyExpenseConflictException("Cashflow week is locked."));

        mockMvc.perform(asViewer(post("/api/v1/cashflow/project-conflict/weekly-update-complete"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "idempotencyKey": "weekly-conflict-http",
                      "yearMonth": "2026-06",
                      "weekNo": 2,
                      "completedAt": "2026-07-09T15:00:00Z",
                      "updateResult": "CHANGED"
                    }
                    """))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("weekly_expense_conflict"))
            .andExpect(jsonPath("$.message").value("Cashflow week is locked."));
    }

    private static MockHttpServletRequestBuilder asViewer(MockHttpServletRequestBuilder request) {
        return request
            .header(InternalServiceTokenFilter.HEADER_NAME, "test-weekly-api-token")
            .header("x-tenant-id", "tenant-a")
            .header("x-actor-id", "viewer-1")
            .header("x-actor-role", "viewer")
            .header("x-actor-email", "viewer@example.com");
    }

    private static TrustedActorContext eqActor(String actorId) {
        return org.mockito.ArgumentMatchers.argThat(actor -> actor != null && actorId.equals(actor.id()));
    }

    private static CashflowWeeklyUpdateCompletionResponse lockedResponse(String commandName) {
        return new CashflowWeeklyUpdateCompletionResponse(
            true,
            commandName,
            "project-a",
            "2026-06",
            2,
            "2026-07-09T15:00:00Z",
            "viewer@example.com",
            false,
            "LOCKED",
            1,
            0,
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            null,
            null,
            null
        );
    }

    private static CashflowWeeklyUpdateCompletionResponse openResponse() {
        return new CashflowWeeklyUpdateCompletionResponse(
            true,
            "cashflowWeeklyUpdate.reopen",
            "project-a",
            "2026-06",
            2,
            "2026-07-09T15:00:00Z",
            "viewer@example.com",
            false,
            "OPEN",
            2,
            1,
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "2026-07-09T16:00:00Z",
            "viewer@example.com",
            "긴급 증빙 정정"
        );
    }
}
