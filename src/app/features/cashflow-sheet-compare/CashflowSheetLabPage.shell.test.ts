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
  it('is mounted at the PM portal cashflow URL without the PortalStore shell', () => {
    expect(routesSource).toContain("path: '/portal/cashflow/sheets-lab'");
    expect(routesSource).not.toContain("path: 'cashflow/sheets-lab'");
    expect(routesSource).toContain('CashflowSheetLabPage');
    expect(portalLayoutSource).toContain('/portal/cashflow/sheets-lab');
    expect(portalCashflowSource).toContain('/portal/cashflow/sheets-lab');
    expect(pageSource).not.toContain('usePortalStore');
    expect(pageSource).not.toContain('../../data/portal-store');
  });

  it('uses the lab BFF client without exposing legacy cashflow write actions', () => {
    expect(pageSource).toContain('previewCashflowSheetLabViaBff');
    expect(pageSource).toContain('saveCashflowSheetLabConfigViaBff');
    expect(pageSource).toContain('applyCashflowSheetLabViaBff');
    expect(pageSource).toContain('source:');
    expect(pageSource).toContain('캐시플로우 반영 미리보기');
    expect(pageSource).toContain('반영');
    expect(pageSource).toContain('가로 스크롤로 전체 주차 확인');
    expect(pageSource).toContain('입금 합계');
    expect(pageSource).toContain('출금 합계');
    expect(pageSource).toContain('잔액');
    expect(pageSource).not.toContain('현재 시트');
    expect(pageSource).not.toContain('upsertCashflowProjectionViaPlatformApi');
    expect(pageSource).not.toContain('exportCashflowWorkbookViaBff');
    expect(pageSource).not.toContain('saveExpenseSheetRows');
    expect(pageSource).not.toContain('markSheetSourceApplied');
    expect(pageSource).not.toContain('동기화');
    expect(pageSource).not.toContain('내보내기');
  });
});
