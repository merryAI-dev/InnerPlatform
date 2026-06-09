import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowExportSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowExportPage.tsx'),
  'utf8',
);

describe('CashflowExportPage Java read hydration contract', () => {
  it('hydrates selected export target projects before building workbook inputs', () => {
    expect(cashflowExportSource).toContain('ensureProjectCashflowSnapshots');
    expect(cashflowExportSource).toContain('targetProjects.map((project) => project.id)');
    expect(cashflowExportSource).toContain('void ensureProjectCashflowSnapshots(targetProjectIds)');
  });

  it('does not calculate actuals locally for export hydration', () => {
    expect(cashflowExportSource).not.toContain('computeCashflowTotals');
    expect(cashflowExportSource).not.toContain('chooseCashflowSheetForNet');
  });
});
