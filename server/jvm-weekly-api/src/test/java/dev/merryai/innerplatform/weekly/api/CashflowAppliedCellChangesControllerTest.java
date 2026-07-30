package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CashflowAppliedCellChangesControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WeeklyExpenseCommandService commandService;

    @Test
    void exposesAuthenticatedProjectScopedReadContract() throws Exception {
        when(commandService.readCashflowAppliedCellChanges(
            new TrustedActorContext("tenant-a", "viewer-a", "viewer@example.com", "viewer", "Viewer A"),
            "project-a", 25, "cursor-a"
        )).thenReturn(new CashflowAppliedCellChangesResponse(List.of(item()), "cursor-b"));

        mockMvc.perform(get("/api/v1/cashflow/project-a/applied-cell-changes")
                .queryParam("limit", "25")
                .queryParam("cursor", "cursor-a")
                .header(InternalServiceTokenFilter.HEADER_NAME, "test-weekly-api-token")
                .header("x-tenant-id", "tenant-a")
                .header("x-actor-id", "viewer-a")
                .header("x-actor-role", "viewer")
                .header("x-actor-email", "viewer@example.com")
                .header("x-actor-name", "Viewer A"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].cellId").value("event-a:0"))
            .andExpect(jsonPath("$.items[0].projectId").value("project-a"))
            .andExpect(jsonPath("$.items[0].beforeHadValue").value(false))
            .andExpect(jsonPath("$.items[0].beforeAmount").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.items[0].afterHadValue").value(true))
            .andExpect(jsonPath("$.items[0].afterState").value("ZERO"))
            .andExpect(jsonPath("$.items[0].afterAmount").value(0))
            .andExpect(jsonPath("$.nextCursor").value("cursor-b"));

        verify(commandService).readCashflowAppliedCellChanges(
            new TrustedActorContext("tenant-a", "viewer-a", "viewer@example.com", "viewer", "Viewer A"),
            "project-a", 25, "cursor-a"
        );
    }

    @Test
    void rejectsMissingServiceAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/cashflow/project-a/applied-cell-changes"))
            .andExpect(status().isUnauthorized());
    }

    private static CashflowAppliedCellChangesResponse.Item item() {
        return new CashflowAppliedCellChangesResponse.Item(
            "event-a", "event-a:0", "project-a", "2026-08", 1, "actual", "SALES_IN",
            false, "EMPTY", null, true, "ZERO", BigDecimal.ZERO,
            "actor-a", "Actor A", "actor@example.com", "approved", "monthly-shard",
            "BATCH_APPLY", "operation-a", "audit-a", "r1", "r2", Instant.parse("2026-07-30T02:00:00Z")
        );
    }
}
