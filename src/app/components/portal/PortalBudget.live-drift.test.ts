import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalBudgetSource = readFileSync(
  resolve(import.meta.dirname, 'PortalBudget.tsx'),
  'utf8',
);
const portalStoreSource = readFileSync(
  resolve(import.meta.dirname, '../../data/portal-store.tsx'),
  'utf8',
);

function extractFunctionSource(source: string, name: string, nextName?: string): string {
  const start = source.indexOf(`const ${name} = useCallback`);
  expect(start, `${name} must exist in portal-store`).toBeGreaterThanOrEqual(0);
  if (!nextName) return source.slice(start);
  const end = source.indexOf(`const ${nextName} = useCallback`, start + 1);
  expect(end, `${nextName} must exist after ${name}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function gitOutput(args: string[]): string {
  return execFileSync('git', args, {
    cwd: resolve(import.meta.dirname, '../../../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe('PortalBudget live drift guard', () => {
  it('keeps the budget UI source identical to live unless the budget scope is explicitly changed', () => {
    gitOutput(['rev-parse', '--verify', 'origin/main']);
    const changedBudgetFiles = gitOutput([
      'diff',
      '--name-only',
      'origin/main...HEAD',
      '--',
      'src/app/components/portal/PortalBudget.tsx',
      'src/app/components/portal/PortalDialogs.tsx',
    ]);

    expect(changedBudgetFiles).toBe('');
  });

  it('keeps budget editing out of the Java weekly expense save path', () => {
    const saveBudgetCodeBook = extractFunctionSource(
      portalStoreSource,
      'saveBudgetCodeBook',
      'saveBudgetTreeV2',
    );

    expect(saveBudgetCodeBook).toContain('budget_code_book/default');
    expect(saveBudgetCodeBook).toContain('budget_summary/default');
    expect(saveBudgetCodeBook).toContain("expense_sheets/${activeExpenseSheetId || 'default'}");
    expect(saveBudgetCodeBook).toContain('budgetEvidenceMaps');
    expect(saveBudgetCodeBook).toContain('serializeExpenseSheetRowForPersistence');
    expect(saveBudgetCodeBook).not.toContain('saveExpenseSheetRows(');
    expect(saveBudgetCodeBook).not.toContain('saveWeeklyExpenseDraftViaBff');
    expect(saveBudgetCodeBook).not.toContain('isPlatformApiEnabled(');
  });

  it('does not move projection or actual comparison UI into the budget component', () => {
    expect(portalBudgetSource).not.toContain('read model hydration');
    expect(portalBudgetSource).not.toContain('ensureProjectCashflowSnapshot');
    expect(portalBudgetSource).not.toContain('weekly-expense-cashflow-summary');
    expect(portalBudgetSource).not.toContain('saveWeeklyExpenseDraftViaBff');
  });
});
