import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const expenseSave = source.slice(
  source.indexOf('const saveExpenseSheetRows ='),
  source.indexOf('const saveBankStatementRows ='),
);
const bankSave = source.slice(
  source.indexOf('const saveBankStatementRows ='),
  source.indexOf('const applyBankStatementRowsToExpenseSheet ='),
);
const bankApply = source.slice(
  source.indexOf('const applyBankStatementRowsToExpenseSheet ='),
  source.indexOf('const refreshBankStatementRows ='),
);

describe('portal store cashflow mutation boundary', () => {
  it('keeps ordinary weekly and bank saves in the owner private draft', () => {
    expect(expenseSave).toContain('if (!options.canonicalFinal)');
    expect(expenseSave).toContain('createCashflowPrivateDraftClient');
    expect(expenseSave).toContain('weeklyExpense:');
    expect(bankSave).toContain('if (!options.canonicalFinal)');
    expect(bankSave).toContain('bankStatement: sanitizedSheet');
    expect(bankSave).not.toContain('/bank_statements/default');
  });

  it('uses fenced JVM commands for explicit canonical weekly and bank final actions', () => {
    expect(expenseSave).toContain('saveWeeklyExpenseDraftViaBff');
    expect(expenseSave).toContain('finalize: options.finalize === true');
    expect(bankApply).toContain('importBankStatementBatchViaBff');
    expect(bankApply).toContain('applyBankStatementItemsViaBff');
    expect(bankApply).toContain('finalize: true');
    expect(bankApply).not.toContain('setDoc(');
  });
});
