package dev.merryai.innerplatform.weekly.api;

import dev.merryai.innerplatform.weekly.domain.WeeklyExpenseIdempotencyEntity;
import dev.merryai.innerplatform.weekly.repository.WeeklyExpenseIdempotencyRepository;
import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CashflowSheetOperationStatusControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WeeklyExpenseIdempotencyRepository idempotencyRepository;

    @BeforeEach
    void clearOperationFixtures() {
        idempotencyRepository.deleteAll();
    }

    @Test
    void returnsStableVersionedEnvelopesForEveryOperationType() throws Exception {
        save("month key/+", """
            {"projectId":"project-a","yearMonth":"2026-07","sourceRevision":"source-month",
             "targetRevision":"target-before","resultingTargetRevision":"target-after","auditId":"audit-month",
             "projection":[{"mustNotLeak":true}]}
            """);
        save("batch-key", """
            {"projectId":"project-a","sourceRevision":"source-batch","targetRevision":"batch-before",
             "resultingTargetRevision":"batch-after","months":[{"yearMonth":"2026-07"},{"yearMonth":"2026-08"}],
             "auditId":"audit-batch","durationMs":42}
            """);
        save("annual-key", """
            {"projectId":"project-a","year":2026,"sourceRevision":"source-annual","revision":7,
             "auditId":"audit-annual","projection":{"mustNotLeak":123}}
            """);

        mockMvc.perform(operation("tenant-a", "project-a", "MONTH_APPLY", "month key/+", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.version").value("1"))
            .andExpect(jsonPath("$.status").value("APPLIED"))
            .andExpect(jsonPath("$.idempotencyKeyHash").value(hash("month key/+")))
            .andExpect(jsonPath("$.idempotencyKey").doesNotExist())
            .andExpect(jsonPath("$.completedAt").isNotEmpty())
            .andExpect(jsonPath("$.appliedMonths[0]").value("2026-07"))
            .andExpect(jsonPath("$.appliedYears").isEmpty())
            .andExpect(jsonPath("$.projection").doesNotExist());
        mockMvc.perform(operation("tenant-a", "project-a", "MONTH_APPLY", "month key/+", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("APPLIED"))
            .andExpect(jsonPath("$.idempotencyKeyHash").value(hash("month key/+")));

        mockMvc.perform(operation("tenant-a", "project-a", "BATCH_APPLY", "batch-key", "viewer"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.expectedTargetRevision").value("batch-before"))
            .andExpect(jsonPath("$.resultingTargetRevision").value("batch-after"))
            .andExpect(jsonPath("$.appliedMonths.length()").value(2));

        mockMvc.perform(operation("tenant-a", "project-a", "ANNUAL_APPLY", "annual-key", "auditor"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.appliedMonths").isEmpty())
            .andExpect(jsonPath("$.appliedYears[0]").value(2026))
            .andExpect(jsonPath("$.annualRevisions[0].year").value(2026))
            .andExpect(jsonPath("$.annualRevisions[0].revision").value(7))
            .andExpect(jsonPath("$.projection").doesNotExist());
    }

    @Test
    void keepsWrongTenantProjectAndOperationTypeIndistinguishableFromMissing() throws Exception {
        save("month-key", """
            {"projectId":"project-a","yearMonth":"2026-07","sourceRevision":"source",
             "targetRevision":"before","resultingTargetRevision":"after","auditId":"audit"}
            """);

        for (MockHttpServletRequestBuilder request : new MockHttpServletRequestBuilder[] {
            operation("tenant-b", "project-a", "MONTH_APPLY", "month-key", "viewer"),
            operation("tenant-a", "project-b", "MONTH_APPLY", "month-key", "viewer"),
            operation("tenant-a", "project-a", "ANNUAL_APPLY", "month-key", "viewer")
        }) {
            mockMvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NOT_FOUND"))
                .andExpect(jsonPath("$.auditId").doesNotExist());
        }
    }

    @Test
    void rejectsMalformedLookupAndEnforcesServiceActorAuthentication() throws Exception {
        mockMvc.perform(operation("tenant-a", "project-a", "month", "key", "viewer"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("weekly_expense_bad_request"));

        mockMvc.perform(operation("tenant-a", "project-a", "MONTH_APPLY", "key", "guest"))
            .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/v1/cashflow/project-a/sheet-lab/operations")
                .queryParam("operationType", "MONTH_APPLY")
                .queryParam("idempotencyKey", "key"))
            .andExpect(status().isUnauthorized());
    }

    private void save(String key, String responseJson) {
        idempotencyRepository.save(new WeeklyExpenseIdempotencyEntity(
            "tenant-a",
            "project-a",
            key,
            WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
            "request-hash",
            responseJson
        ));
    }

    private static MockHttpServletRequestBuilder operation(
        String tenantId,
        String projectId,
        String operationType,
        String key,
        String role
    ) {
        return get("/api/v1/cashflow/{projectId}/sheet-lab/operations", projectId)
            .queryParam("operationType", operationType)
            .queryParam("idempotencyKey", key)
            .header(InternalServiceTokenFilter.HEADER_NAME, "test-weekly-api-token")
            .header("x-tenant-id", tenantId)
            .header("x-actor-id", "service-actor")
            .header("x-actor-role", role)
            .header("x-actor-email", "service@example.com");
    }

    private static String hash(String key) throws Exception {
        return "sha256:" + HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8))
        );
    }
}
