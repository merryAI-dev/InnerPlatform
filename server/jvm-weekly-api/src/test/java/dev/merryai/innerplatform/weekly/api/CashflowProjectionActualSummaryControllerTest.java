package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CashflowProjectionActualSummaryControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WeeklyExpenseCommandService commandService;

    @Test
    void serializesSuccessfulAndFailedProjectsWithoutInternalFailureDetails() throws Exception {
        TrustedActorContext actor = new TrustedActorContext(
            "tenant-a", "viewer-a", "viewer@example.com", "viewer", "Viewer A"
        );
        CashflowProjectionActualSummaryBatchRequest request =
            new CashflowProjectionActualSummaryBatchRequest(List.of("project-a", "project-b"));
        when(commandService.readCashflowProjectionActualSummaries(actor, request)).thenReturn(
            new CashflowProjectionActualSummaryBatchResponse(
                "1",
                List.of(new CashflowProjectionActualSummaryBatchResponse.Item(
                    "project-a", "2023-01",
                    new CashflowProjectionActualSummaryBatchResponse.ComparisonAsOfWeek("2026-07", 5),
                    BigDecimal.TEN, false
                )),
                List.of(new CashflowProjectionActualSummaryBatchResponse.ErrorItem(
                    "project-b", "SUMMARY_UNAVAILABLE"
                ))
            )
        );

        mockMvc.perform(post("/api/v1/cashflow/projection-actual-summary/batch")
                .header(InternalServiceTokenFilter.HEADER_NAME, "test-weekly-api-token")
                .header("x-tenant-id", "tenant-a")
                .header("x-actor-id", "viewer-a")
                .header("x-actor-role", "viewer")
                .header("x-actor-email", "viewer@example.com")
                .header("x-actor-name", "Viewer A")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"projectIds\":[\"project-a\",\"project-b\"]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.version").value("1"))
            .andExpect(jsonPath("$.items[0].projectId").value("project-a"))
            .andExpect(jsonPath("$.errors[0].projectId").value("project-b"))
            .andExpect(jsonPath("$.errors[0].code").value("SUMMARY_UNAVAILABLE"))
            .andExpect(content().string(org.hamcrest.Matchers.not(
                org.hamcrest.Matchers.containsString("secret")
            )));
    }
}
