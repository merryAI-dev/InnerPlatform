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
    expect(portalCashflowSource).toContain('cashflow.sheet_lab.portal.toolbar.dispatch');
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
    expect(pageSource).toContain('auth.popup.start');
    expect(pageSource).toContain('loginWithGoogle');
    expect(pageSource).not.toContain("navigate('/login'");
    expect(pageSource).toContain('runWithBffAuthRetry');
    expect(pageSource).not.toContain('runWithGoogleSheetsAuthRetry');
    expect(pageSource).not.toContain('ensureGoogleWorkspaceAccess');
    expect(pageSource).not.toContain('googleAccessToken');
    expect(pageSource).not.toContain('token_pass_through');
    expect(pageSource).not.toContain('service_account_fallback');
    expect(pageSource).not.toContain('google_token_required');
    expect(pageSource).not.toContain('Google Sheets 권한 연결이 필요합니다.');
    expect(pageSource).not.toContain('isGoogleSheetsTokenExpiredError');
    expect(pageSource).toContain('google_sheet_service_account_forbidden');
    expect(pageSource).toContain('시트를 시스템 계정');
    expect(pageSource).toContain('systemAccountEmail');
    expect(pageSource).not.toContain('mysc:cashflow-sheet-lab-action');
    expect(pageSource).toContain('useImperativeHandle');
    expect(portalCashflowSource).toContain('sheetLabRef.current?.connect()');
    expect(portalCashflowSource).toContain('sheetLabRef.current?.preview()');
    expect(pageSource).toContain('handleConnectSheet');
    expect(pageSource).toContain('config.load.ok');
    expect(pageSource).toContain('저장된 설정 불러오기');
    expect(pageSource).toContain('config.save.ok');
    expect(pageSource).toContain('toolbar.action');
    expect(pageSource).toContain('config.editor.open');
    expect(pageSource).toContain('config.editor.cancel');
    expect(pageSource).toContain('writeback.wizard.open');
    expect(pageSource).toContain('!hideConfigChrome || editingConfig || config || errorMessage');
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
    expect(pageSource).toContain('MYSC 시스템 계정');
    expect(pageSource).not.toContain("action === 'apply'");
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
    expect(pageSource).not.toContain("addEventListener('mysc:cashflow-projection-saved'");
  });

  it('recovers BFF auth failures with a popup retry instead of redirecting', () => {
    const configLoadSource = pageSource.slice(
      pageSource.indexOf('const fetchConfig ='),
      pageSource.indexOf('async function handleSaveConfig'),
    );

    expect(configLoadSource).toContain('config.load.error');
    expect(configLoadSource).toContain('setEditingConfig(true)');
    expect(pageSource).toContain('requestBffActorAfterAuth');
    expect(pageSource).toContain('bffAuth.popup.required');
    expect(pageSource).toContain('bffAuth.rejected');
    expect(pageSource).toContain('firebaseToken || actor.idToken');
    expect(pageSource).toContain('getIdToken(Boolean(options.forceRefresh))');
    expect(pageSource).not.toContain('actor.idToken || firebaseToken');
    expect(pageSource).not.toContain("navigate('/login'");
  });
});
