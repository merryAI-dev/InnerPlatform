package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseForbiddenException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WeeklyExpenseAuthorizationServiceTest {
    @Test
    void pmCanMutateOnlyAssignedProject() {
        WeeklyExpenseAuthorizationService service = new WeeklyExpenseAuthorizationService(
            (actor, projectId) -> "project-allowed".equals(projectId),
            "strict"
        );
        TrustedActorContext pm = new TrustedActorContext("tenant-a", "pm-1", "pm@example.com", "pm");

        assertThatCode(() -> service.requireProjectAllowed(
            WeeklyExpenseCommandService.SAVE_DRAFT_COMMAND,
            pm,
            "project-allowed"
        )).doesNotThrowAnyException();

        assertThatThrownBy(() -> service.requireProjectAllowed(
            WeeklyExpenseCommandService.SAVE_DRAFT_COMMAND,
            pm,
            "project-denied"
        ))
            .isInstanceOf(WeeklyExpenseForbiddenException.class)
            .hasMessageContaining("not assigned");
    }

    @Test
    void tenantWideRolesStillRespectCommandRoleGate() {
        WeeklyExpenseAuthorizationService service = new WeeklyExpenseAuthorizationService(
            (actor, projectId) -> false,
            "strict"
        );
        TrustedActorContext finance = new TrustedActorContext("tenant-a", "finance-1", "finance@example.com", "finance");
        TrustedActorContext auditor = new TrustedActorContext("tenant-a", "auditor-1", "auditor@example.com", "auditor");

        assertThatCode(() -> service.requireProjectAllowed(
            WeeklyExpenseCommandService.UPSERT_PROJECTION_COMMAND,
            finance,
            "project-any"
        )).doesNotThrowAnyException();

        assertThatThrownBy(() -> service.requireProjectAllowed(
            WeeklyExpenseCommandService.SAVE_DRAFT_COMMAND,
            auditor,
            "project-any"
        )).isInstanceOf(WeeklyExpenseForbiddenException.class);
    }

    @Test
    void workspaceUserCanRunWeeklyCashflowAndAuditCommandsWithoutProjectAssignment() {
        WeeklyExpenseAuthorizationService service = new WeeklyExpenseAuthorizationService(
            (actor, projectId) -> false,
            "internal_saas_workspace"
        );
        TrustedActorContext workspaceUser = new TrustedActorContext(
            "tenant-a",
            "firebase-user-1",
            "user@mysc.co.kr",
            "workspace_user",
            "사용자"
        );

        assertThatCode(() -> service.requireProjectAllowed(
            WeeklyExpenseCommandService.BANK_IMPORT_BATCH_COMMAND,
            workspaceUser,
            "project-any"
        )).doesNotThrowAnyException();
        assertThatCode(() -> service.requireProjectAllowed(
            WeeklyExpenseCommandService.UPSERT_PROJECTION_COMMAND,
            workspaceUser,
            "project-any"
        )).doesNotThrowAnyException();
        assertThatCode(() -> service.requireProjectAllowed(
            WeeklyExpenseCommandService.AUDIT_EXPORT_CREATE_COMMAND,
            workspaceUser,
            "project-any"
        )).doesNotThrowAnyException();
    }
}
