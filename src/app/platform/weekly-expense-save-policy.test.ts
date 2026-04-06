import { describe, expect, it } from 'vitest';

import { resolveWeeklyExpenseSavePolicy } from './weekly-expense-save-policy';

describe('resolveWeeklyExpenseSavePolicy', () => {
  it('locks weekly expense editing to manual saves', () => {
    expect(resolveWeeklyExpenseSavePolicy()).toEqual({
      mode: 'manual',
      showStatusSurface: true,
    });
  });
});
