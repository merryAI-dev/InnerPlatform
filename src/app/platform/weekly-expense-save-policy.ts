export type WeeklyExpenseSaveMode = 'auto' | 'manual';

export interface WeeklyExpenseSavePolicy {
  mode: WeeklyExpenseSaveMode;
  idleMs: number;
  syncCashflowOnAutoSave: boolean;
  showStatusButton: boolean;
  showInlineStatus: boolean;
  guideMinimizable: boolean;
}

export interface WeeklyExpenseAutosavePlanInput {
  saveMode: WeeklyExpenseSaveMode;
  idleMs: number;
  syncCashflowOnAutoSave: boolean;
  importDirty: boolean;
  hasImportRows: boolean;
  hasSaveHandler: boolean;
  sheetSaving: boolean;
}

export interface WeeklyExpenseAutosavePlan {
  shouldSchedule: boolean;
  idleMs: number;
  syncCashflow: boolean;
}

export function resolveWeeklyExpenseSavePolicy(): WeeklyExpenseSavePolicy {
  return {
    mode: 'auto',
    idleMs: 120_000,
    syncCashflowOnAutoSave: true,
    showStatusButton: true,
    showInlineStatus: false,
    guideMinimizable: true,
  };
}

export function resolveWeeklyExpenseAutosavePlan(
  input: WeeklyExpenseAutosavePlanInput,
): WeeklyExpenseAutosavePlan {
  return {
    shouldSchedule: (
      input.saveMode === 'auto'
      && input.importDirty
      && input.hasImportRows
      && input.hasSaveHandler
      && !input.sheetSaving
    ),
    idleMs: input.idleMs,
    syncCashflow: input.syncCashflowOnAutoSave,
  };
}
