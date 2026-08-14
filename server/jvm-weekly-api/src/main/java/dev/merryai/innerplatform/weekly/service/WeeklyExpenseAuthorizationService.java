package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseForbiddenException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class WeeklyExpenseAuthorizationService {
    private static final Set<String> TENANT_WIDE_PROJECT_ROLES = Set.of(
        "admin",
        "finance",
        "auditor",
        "tenant_admin",
        "support",
        "security"
    );
    private static final Set<String> WORKSPACE_COMMANDS = Set.of(
        WeeklyExpenseCommandService.SAVE_DRAFT_COMMAND,
        WeeklyExpenseCommandService.SHEET_READ_COMMAND,
        WeeklyExpenseCommandService.BANK_IMPORT_BATCH_COMMAND,
        WeeklyExpenseCommandService.BANK_IMPORT_LIST_LINES_COMMAND,
        WeeklyExpenseCommandService.BANK_IMPORT_APPLY_ITEMS_COMMAND,
        WeeklyExpenseCommandService.UPSERT_PROJECTION_COMMAND,
        WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND,
        WeeklyExpenseCommandService.SUBMIT_WEEK_COMMAND,
        WeeklyExpenseCommandService.CLOSE_WEEK_COMMAND,
        WeeklyExpenseCommandService.WEEKLY_STATUS_READ_COMMAND,
        WeeklyExpenseCommandService.CELL_PATCH_COMMAND,
        WeeklyExpenseCommandService.CELLS_COPY_COMMAND,
        WeeklyExpenseCommandService.CELLS_PASTE_COMMAND,
        WeeklyExpenseCommandService.CELLS_CUT_COMMAND,
        WeeklyExpenseCommandService.ROW_INSERT_COMMAND,
        WeeklyExpenseCommandService.ROW_DELETE_COMMAND,
        WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND,
        WeeklyExpenseCommandService.CASHFLOW_VARIANCE_COMMAND,
        WeeklyExpenseCommandService.CASHFLOW_MONTH_CLOSE_READ_COMMAND,
        WeeklyExpenseCommandService.READ_CASHFLOW_WEEKLY_UPDATE_COMMAND,
        WeeklyExpenseCommandService.CLOSE_CASHFLOW_MONTH_COMMAND,
        WeeklyExpenseCommandService.COMPLETE_CASHFLOW_WEEKLY_UPDATE_COMMAND,
        WeeklyExpenseCommandService.REOPEN_CASHFLOW_WEEKLY_UPDATE_COMMAND,
        WeeklyExpenseCommandService.REQUEST_CASHFLOW_MONTH_REOPEN_COMMAND,
        WeeklyExpenseCommandService.DECIDE_CASHFLOW_MONTH_REOPEN_COMMAND,
        WeeklyExpenseCommandService.AUDIT_EXPORT_CREATE_COMMAND
    );
    private static final Map<String, Set<String>> COMMAND_ROLES = Map.ofEntries(
        Map.entry(WeeklyExpenseCommandService.SAVE_DRAFT_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.SHEET_READ_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.BANK_IMPORT_BATCH_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.BANK_IMPORT_LIST_LINES_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.BANK_IMPORT_APPLY_ITEMS_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.UPSERT_PROJECTION_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND, Set.of("admin", "finance", "pm", "viewer", "tenant_admin")),
        Map.entry(WeeklyExpenseCommandService.SUBMIT_WEEK_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.WEEKLY_STATUS_READ_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.CELL_PATCH_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CELLS_COPY_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CELLS_PASTE_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CELLS_CUT_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.ROW_INSERT_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.ROW_DELETE_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.CASHFLOW_VARIANCE_COMMAND, Set.of("admin", "finance", "pm", "tenant_admin")),
        Map.entry(WeeklyExpenseCommandService.CASHFLOW_MONTH_CLOSE_READ_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.READ_CASHFLOW_WEEKLY_UPDATE_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.CLOSE_CASHFLOW_MONTH_COMMAND, Set.of("admin", "finance", "pm", "viewer", "tenant_admin")),
        Map.entry(WeeklyExpenseCommandService.COMPLETE_CASHFLOW_WEEKLY_UPDATE_COMMAND, Set.of("admin", "finance", "pm", "viewer", "tenant_admin")),
        Map.entry(WeeklyExpenseCommandService.REOPEN_CASHFLOW_WEEKLY_UPDATE_COMMAND, Set.of("admin", "finance", "pm", "viewer", "tenant_admin")),
        Map.entry(WeeklyExpenseCommandService.REQUEST_CASHFLOW_MONTH_REOPEN_COMMAND, Set.of("admin", "finance", "pm", "viewer", "tenant_admin")),
        Map.entry(WeeklyExpenseCommandService.DECIDE_CASHFLOW_MONTH_REOPEN_COMMAND, Set.of(
            "admin", "finance", "pm", "viewer", "tenant_admin", "auditor", "support", "security"
        )),
        Map.entry(WeeklyExpenseCommandService.CLOSE_WEEK_COMMAND, Set.of("admin", "finance")),
        Map.entry(WeeklyExpenseCommandService.AUDIT_EXPORT_CREATE_COMMAND, Set.of("admin", "finance"))
    );

    private final WeeklyProjectAccessRepository projectAccessRepository;
    private final WeeklyProjectExistenceRepository projectExistenceRepository;
    private final String authMode;

    public WeeklyExpenseAuthorizationService(
        WeeklyProjectAccessRepository projectAccessRepository,
        WeeklyProjectExistenceRepository projectExistenceRepository,
        @Value("${weekly.auth-mode:strict}") String authMode
    ) {
        this.projectAccessRepository = projectAccessRepository;
        this.projectExistenceRepository = projectExistenceRepository;
        this.authMode = authMode == null ? "strict" : authMode.trim().toLowerCase(Locale.ROOT);
    }

    public void requireAllowed(String commandName, TrustedActorContext actor) {
        String role = actor == null || actor.role() == null
            ? ""
            : actor.role().trim().toLowerCase(Locale.ROOT);
        if (isWorkspaceMode() && "workspace_user".equals(role) && WORKSPACE_COMMANDS.contains(commandName)) {
            return;
        }
        Set<String> allowed = COMMAND_ROLES.getOrDefault(commandName, Set.of());
        if (!allowed.contains(role)) {
            throw new WeeklyExpenseForbiddenException("Actor role is not allowed to run " + commandName + ".");
        }
    }

    public void requireProjectAllowed(String commandName, TrustedActorContext actor, String projectId) {
        requireAllowed(commandName, actor);
        if (!projectExistsForCommand(commandName, actor, projectId)) {
            throw new WeeklyExpenseForbiddenException("Project does not exist in this workspace.");
        }
        String role = actor == null || actor.role() == null
            ? ""
            : actor.role().trim().toLowerCase(Locale.ROOT);
        if (isWorkspaceMode() && "workspace_user".equals(role) && WORKSPACE_COMMANDS.contains(commandName)) {
            return;
        }
        if (TENANT_WIDE_PROJECT_ROLES.contains(role)) {
            return;
        }
        if (projectAccessRepository.hasProjectAccess(actor, projectId)) {
            return;
        }
        throw new WeeklyExpenseForbiddenException("Actor is not assigned to this project.");
    }

    public void requireProjectsAllowed(String commandName, TrustedActorContext actor, List<String> projectIds) {
        requireProjectsAllowedForCommands(List.of(commandName), actor, projectIds);
    }

    public void requireProjectsAllowedForCommands(
        List<String> commandNames,
        TrustedActorContext actor,
        List<String> projectIds
    ) {
        if (commandNames == null || commandNames.isEmpty()) {
            throw new IllegalArgumentException("At least one command is required for project authorization.");
        }
        for (String commandName : commandNames) requireAllowed(commandName, actor);
        if (projectIds == null || projectIds.isEmpty()
            || !projectExistenceRepository.existingProjectIds(actor.tenantId(), projectIds).containsAll(projectIds)) {
            throw new WeeklyExpenseForbiddenException("Project does not exist in this workspace.");
        }
        String role = actor.role() == null ? "" : actor.role().trim().toLowerCase(Locale.ROOT);
        if ((isWorkspaceMode() && "workspace_user".equals(role) && commandNames.stream().allMatch(WORKSPACE_COMMANDS::contains))
            || TENANT_WIDE_PROJECT_ROLES.contains(role)) {
            return;
        }
        for (String projectId : projectIds) {
            if (!projectAccessRepository.hasProjectAccess(actor, projectId)) {
                throw new WeeklyExpenseForbiddenException("Actor is not assigned to this project.");
            }
        }
    }

    private boolean isWorkspaceMode() {
        return "internal_saas_workspace".equals(authMode) || "workspace".equals(authMode);
    }

    private boolean projectExistsForCommand(String commandName, TrustedActorContext actor, String projectId) {
        String tenantId = actor == null ? "" : actor.tenantId();
        if (WeeklyExpenseCommandService.CASHFLOW_SHEET_LAB_APPLY_COMMAND.equals(commandName)) {
            return projectExistenceRepository.existsCanonicalProject(tenantId, projectId);
        }
        return projectExistenceRepository.exists(tenantId, projectId);
    }
}
