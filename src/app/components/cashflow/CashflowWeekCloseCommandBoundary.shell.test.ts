import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowProjectSheetSource = readFileSync(resolve(import.meta.dirname, 'CashflowProjectSheet.tsx'), 'utf8');

describe('cashflow week close command boundary', () => {
  it('routes admin week close through a BFF command instead of direct closeWeekAsAdmin writes', () => {
    expect(cashflowProjectSheetSource).toContain('closeCashflowWeekViaBff');
    expect(cashflowProjectSheetSource).not.toContain('await closeWeekAsAdmin({ projectId, yearMonth, weekNo });');
  });
});
