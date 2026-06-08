package dev.merryai.innerplatform.weekly.service;

import dev.merryai.innerplatform.weekly.api.TrustedActorContext;
import dev.merryai.innerplatform.weekly.api.WeeklyExpenseForbiddenException;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class WeeklyExpenseAuthorizationService {
    private static final Map<String, Set<String>> COMMAND_ROLES = Map.ofEntries(
        Map.entry(WeeklyExpenseCommandService.SAVE_DRAFT_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.BANK_IMPORT_BATCH_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.BANK_IMPORT_LIST_LINES_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.BANK_IMPORT_APPLY_ITEMS_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.UPSERT_PROJECTION_COMMAND, Set.of("admin", "finance")),
        Map.entry(WeeklyExpenseCommandService.SUBMIT_WEEK_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.WEEKLY_STATUS_READ_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.CELL_PATCH_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CELLS_COPY_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CELLS_PASTE_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CELLS_CUT_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.ROW_INSERT_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.ROW_DELETE_COMMAND, Set.of("admin", "finance", "pm")),
        Map.entry(WeeklyExpenseCommandService.CASHFLOW_READ_COMMAND, Set.of("admin", "finance", "pm", "auditor", "viewer", "tenant_admin", "support", "security")),
        Map.entry(WeeklyExpenseCommandService.CLOSE_WEEK_COMMAND, Set.of("admin", "finance")),
        Map.entry(WeeklyExpenseCommandService.AUDIT_EXPORT_CREATE_COMMAND, Set.of("admin", "finance"))
    );

    public void requireAllowed(String commandName, TrustedActorContext actor) {
        String role = actor == null || actor.role() == null
            ? ""
            : actor.role().trim().toLowerCase(Locale.ROOT);
        Set<String> allowed = COMMAND_ROLES.getOrDefault(commandName, Set.of());
        if (!allowed.contains(role)) {
            throw new WeeklyExpenseForbiddenException("Actor role is not allowed to run " + commandName + ".");
        }
    }
}
