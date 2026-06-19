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
  it('is mounted inside the PM portal cashflow route shell', () => {
    expect(routesSource).toContain("path: '/portal'");
    expect(routesSource).toContain("path: 'cashflow/sheets-lab'");
    expect(routesSource).toContain('CashflowSheetLabPage');
    expect(routesSource).not.toContain('StageOnlyCashflowSheetLabRoute');
    expect(portalLayoutSource).toContain('/portal/cashflow/sheets-lab');
    expect(portalCashflowSource).toContain('CashflowSheetLabPage');
    expect(portalCashflowSource).toContain('projectIdOverride={projectId}');
    expect(portalCashflowSource).toContain('embedded');
    expect(portalCashflowSource).toContain('hideConfigChrome');
    expect(portalCashflowSource).toContain("dispatchSheetAction('connect')");
    expect(portalCashflowSource).not.toContain("dispatchSheetAction('apply')");
    expect(portalCashflowSource).toContain('시트와 연동하기');
    expect(portalCashflowSource).not.toContain('shouldShowCashflowSheetLab');
    expect(portalCashflowSource).not.toContain('deployment-surface');
    expect(portalCashflowSource).not.toMatch(/show[A-Za-z0-9]*Sheet[A-Za-z0-9]*Lab\s*&&/);
    expect(pageSource).not.toContain('usePortalStore');
    expect(pageSource).not.toContain('../../data/portal-store');
  });

  it('uses the lab BFF client without exposing legacy cashflow write actions', () => {
    expect(pageSource).toContain('previewCashflowSheetLabViaBff');
    expect(pageSource).toContain('saveCashflowSheetLabConfigViaBff');
    expect(pageSource).toContain('previewCashflowProjectionWritebackViaBff');
    expect(pageSource).toContain('applyCashflowProjectionWritebackViaBff');
    expect(pageSource).toContain('resolveBffActor');
    expect(pageSource).toContain('requireBffActor');
    expect(pageSource).toContain('requestLoginFlow');
    expect(pageSource).toContain('runWithGoogleSheetsAuthRetry');
    expect(pageSource).toContain("runWithGoogleSheetsAuthRetry('config.save'");
    expect(pageSource).toContain('service_account_fallback');
    expect(pageSource).not.toContain('google_token_required');
    expect(pageSource).not.toContain('Google Sheets 권한 연결이 필요합니다.');
    expect(pageSource).toContain('isGoogleSheetsTokenExpiredError');
    expect(pageSource).toContain('mysc:cashflow-sheet-lab-action');
    expect(pageSource).toContain("action === 'connect' || action === 'edit'");
    expect(pageSource).toContain('onHeaderSummaryChange');
    expect(pageSource).toContain('시트 업데이트');
    expect(pageSource).toContain('입금 합계');
    expect(pageSource).toContain('출금 합계');
    expect(pageSource).toContain('잔액');
    expect(pageSource).toContain('합계 기준');
    expect(pageSource).not.toContain('시트와 연동할까요?');
    expect(pageSource).not.toContain('주차별 원본');
    expect(pageSource).not.toContain('원본 접기');
    expect(pageSource).not.toContain('캐시플로우 반영 미리보기');
    expect(pageSource).not.toContain('nonEmptyCellCount');
    expect(pageSource).not.toContain('Spreadsheet ID');
    expect(pageSource).not.toContain('Google 토큰');
    expect(pageSource).not.toContain('MYSC 시스템 계정');
    expect(pageSource).not.toContain('source:');
    expect(pageSource).not.toContain('Scope:');
    expect(pageSource).not.toContain('Role:');
    expect(pageSource).not.toContain('Cache:');
    expect(pageSource).not.toContain('Store:');
    expect(pageSource).not.toContain('가로 스크롤로 전체 주차 확인');
    expect(pageSource).not.toContain('현재 시트');
    expect(pageSource).not.toContain('upsertCashflowProjectionViaPlatformApi');
    expect(pageSource).not.toContain('exportCashflowWorkbookViaBff');
    expect(pageSource).not.toContain('saveExpenseSheetRows');
    expect(pageSource).not.toContain('markSheetSourceApplied');
  });
});
