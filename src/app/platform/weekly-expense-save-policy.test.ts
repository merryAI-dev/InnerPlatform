import { describe, expect, it } from 'vitest';

import {
  resolveWeeklyExpenseAutosavePlan,
  resolveWeeklyExpenseSavePolicy,
} from './weekly-expense-save-policy';

describe('resolveWeeklyExpenseSavePolicy', () => {
  it('enables idle autosave with cashflow sync after 120 seconds', () => {
    expect(resolveWeeklyExpenseSavePolicy()).toEqual({
      mode: 'auto',
      idleMs: 120_000,
      syncCashflowOnAutoSave: true,
      showStatusButton: true,
      showInlineStatus: false,
      guideMinimizable: true,
    });
  });
});

describe('resolveWeeklyExpenseAutosavePlan', () => {
  it('runs only when auto save is enabled and the editor is idle-dirty', () => {
    expect(resolveWeeklyExpenseAutosavePlan({
      saveMode: 'auto',
      idleMs: 120_000,
      syncCashflowOnAutoSave: true,
      importDirty: true,
      hasImportRows: true,
      hasSaveHandler: true,
      sheetSaving: false,
    })).toEqual({
      shouldSchedule: true,
      idleMs: 120_000,
      syncCashflow: true,
    });
  });

  it('stays disabled while a save is already in flight', () => {
    expect(resolveWeeklyExpenseAutosavePlan({
      saveMode: 'auto',
      idleMs: 120_000,
      syncCashflowOnAutoSave: true,
      importDirty: true,
      hasImportRows: true,
      hasSaveHandler: true,
      sheetSaving: true,
    })).toEqual({
      shouldSchedule: false,
      idleMs: 120_000,
      syncCashflow: true,
    });
  });

  it('stays disabled when the editor is clean or manual-save only', () => {
    expect(resolveWeeklyExpenseAutosavePlan({
      saveMode: 'manual',
      idleMs: 120_000,
      syncCashflowOnAutoSave: true,
      importDirty: true,
      hasImportRows: true,
      hasSaveHandler: true,
      sheetSaving: false,
    }).shouldSchedule).toBe(false);

    expect(resolveWeeklyExpenseAutosavePlan({
      saveMode: 'auto',
      idleMs: 120_000,
      syncCashflowOnAutoSave: true,
      importDirty: false,
      hasImportRows: true,
      hasSaveHandler: true,
      sheetSaving: false,
    }).shouldSchedule).toBe(false);
  });
});
