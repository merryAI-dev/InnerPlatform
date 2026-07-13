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
const weeklyStatus = source.slice(
  source.indexOf('const upsertWeeklySubmissionStatus ='),
  source.indexOf('const createProjectRequest ='),
);
const evidenceRequiredMapSave = source.slice(
  source.indexOf('const saveEvidenceRequiredMap ='),
  source.indexOf('const markSheetSourceApplied ='),
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

  it('sends weekly status intent to the BFF without a direct Firestore mutation', () => {
    expect(weeklyStatus).toContain('applyWeeklySubmissionStatusIntentViaBff');
    expect(weeklyStatus).toContain('cashflowLease');
    expect(weeklyStatus).not.toContain('setDoc(');
    expect(weeklyStatus).not.toContain('updateDoc(');
  });

  it('sends evidence-required maps through the fenced BFF command', () => {
    expect(evidenceRequiredMapSave).toContain('applyEvidenceRequiredMapIntentViaBff');
    expect(evidenceRequiredMapSave).toContain('cashflowLease');
    expect(evidenceRequiredMapSave).not.toContain('setDoc(');
    expect(evidenceRequiredMapSave).not.toContain('updateDoc(');
  });
});
