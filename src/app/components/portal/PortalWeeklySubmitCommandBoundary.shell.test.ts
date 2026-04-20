import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weeklyExpenseSource = readFileSync(resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'), 'utf8');

describe('weekly submit command boundary', () => {
  it('routes PM weekly submit through a portal submission command instead of split client writes', () => {
    expect(weeklyExpenseSource).toContain('submitPortalWeeklySubmissionViaBff');
    expect(weeklyExpenseSource).not.toContain("await submitWeekAsPm({ projectId, yearMonth, weekNo });");
    expect(weeklyExpenseSource).not.toContain("await changeTransactionState(txId, 'SUBMITTED');");
  });
});
