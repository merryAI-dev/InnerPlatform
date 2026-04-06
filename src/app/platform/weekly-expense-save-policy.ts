export type WeeklyExpenseSaveMode = 'auto' | 'manual';

export interface WeeklyExpenseSavePolicy {
  mode: WeeklyExpenseSaveMode;
  showStatusButton: boolean;
  showInlineStatus: boolean;
  guideMinimizable: boolean;
}

export function resolveWeeklyExpenseSavePolicy(): WeeklyExpenseSavePolicy {
  return {
    mode: 'manual',
    showStatusButton: true,
    showInlineStatus: false,
    guideMinimizable: true,
  };
}
