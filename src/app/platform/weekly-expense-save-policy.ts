export type WeeklyExpenseSaveMode = 'auto' | 'manual';

export interface WeeklyExpenseSavePolicy {
  mode: WeeklyExpenseSaveMode;
  showStatusSurface: boolean;
}

export function resolveWeeklyExpenseSavePolicy(): WeeklyExpenseSavePolicy {
  return {
    mode: 'manual',
    showStatusSurface: true,
  };
}
