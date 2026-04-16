import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weeklyExpenseSource = readFileSync(resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'), 'utf8');
const settlementLedgerSource = readFileSync(resolve(import.meta.dirname, '../cashflow/SettlementLedgerPage.tsx'), 'utf8');

describe('weekly expense command boundary', () => {
  it('routes weekly expense save through the portal weekly expense command BFF path', () => {
    expect(weeklyExpenseSource).toContain('savePortalWeeklyExpenseViaBff');
    expect(weeklyExpenseSource).not.toContain('saveExpenseSheetRows,');
    expect(weeklyExpenseSource).not.toContain('upsertWeeklySubmissionStatus,');
    expect(weeklyExpenseSource).not.toContain('upsertWeekAmounts } = useCashflowWeeks();');
  });

  it('keeps settlement save orchestration behind a single command callback', () => {
    expect(settlementLedgerSource).toContain('onSaveWeeklyExpense');
    expect(settlementLedgerSource).not.toContain('onUpdateWeeklySubmissionStatus');
    expect(settlementLedgerSource).not.toContain('useCashflowWeeks');
    expect(settlementLedgerSource).not.toContain('upsertWeekAmounts');
  });
});
