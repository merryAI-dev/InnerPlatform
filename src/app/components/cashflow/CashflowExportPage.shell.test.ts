import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowExportPageSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowExportPage.tsx'),
  'utf8',
);

describe('CashflowExportPage Java read model contract', () => {
  it('hydrates project cashflow snapshots before building export preview state', () => {
    expect(cashflowExportPageSource).toContain('useHydrateCashflowSnapshots');
    expect(cashflowExportPageSource).toContain('projects.map((project) => project.id)');
    expect(cashflowExportPageSource).toContain('exportCashflowWorkbookViaBff');
  });
});
