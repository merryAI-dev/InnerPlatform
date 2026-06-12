import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowSheetLabPage.tsx'),
  'utf8',
);
const routesSource = readFileSync(
  resolve(import.meta.dirname, '../../routes.tsx'),
  'utf8',
);
const portalLayoutSource = readFileSync(
  resolve(import.meta.dirname, '../../components/portal/PortalLayout.tsx'),
  'utf8',
);
const portalCashflowSource = readFileSync(
  resolve(import.meta.dirname, '../../components/portal/PortalCashflowPage.tsx'),
  'utf8',
);

describe('CashflowSheetLabPage shell', () => {
  it('is mounted in the PM portal cashflow area', () => {
    expect(routesSource).toContain("path: 'cashflow/sheets-lab'");
    expect(routesSource).toContain('CashflowSheetLabPage');
    expect(portalLayoutSource).toContain('/portal/cashflow/sheets-lab');
    expect(portalCashflowSource).toContain('/portal/cashflow/sheets-lab');
  });

  it('uses the readonly lab client and does not expose write-looking actions', () => {
    expect(pageSource).toContain('previewCashflowSheetLabViaBff');
    expect(pageSource).toContain('source:');
    expect(pageSource).not.toContain('upsertCashflowProjectionViaPlatformApi');
    expect(pageSource).not.toContain('exportCashflowWorkbookViaBff');
    expect(pageSource).not.toContain('saveExpenseSheetRows');
    expect(pageSource).not.toContain('markSheetSourceApplied');
    expect(pageSource).not.toContain('동기화');
    expect(pageSource).not.toContain('내보내기');
    expect(pageSource).not.toContain('저장');
  });
});
