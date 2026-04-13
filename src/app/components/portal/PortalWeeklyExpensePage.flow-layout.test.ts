import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weeklyExpenseSource = readFileSync(
  resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'),
  'utf8',
);

describe('PortalWeeklyExpensePage flow layout', () => {
  it('surfaces bank-statement-to-weekly alignment with a direct source message', () => {
    expect(weeklyExpenseSource).toContain('통장내역 기준본에서 이어서 작업');
  });

  it('uses a Korean first-action heading instead of the previous English label', () => {
    expect(weeklyExpenseSource).toContain('지금 해야 할 일');
    expect(weeklyExpenseSource).not.toContain('Next Action');
  });
});
