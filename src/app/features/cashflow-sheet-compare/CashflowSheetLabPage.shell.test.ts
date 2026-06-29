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
  it('keeps sheet lab as an explicit route, not auto-mounted inside portal cashflow', () => {
    expect(routesSource).toContain("path: '/portal'");
    expect(routesSource).toContain("path: 'cashflow/sheets-lab'");
    expect(routesSource).toContain('CashflowSheetLabPage');
    expect(routesSource).not.toContain('StageOnlyCashflowSheetLabRoute');
    expect(portalLayoutSource).toContain("to: '/portal/cashflow/sheets-lab'");
    expect(portalLayoutSource).toContain("hidden: true");
    expect(portalCashflowSource).not.toContain('CashflowSheetLabPage');
    expect(portalCashflowSource).not.toContain('projectIdOverride={projectId}');
    expect(portalCashflowSource).not.toContain('embedded');
    expect(portalCashflowSource).not.toContain('hideConfigChrome');
    expect(portalCashflowSource).not.toContain('dispatchSheetAction');
    expect(portalCashflowSource).not.toContain("dispatchSheetAction('connect')");
    expect(portalCashflowSource).not.toContain('cashflow.sheet_lab.portal.toolbar.dispatch');
    expect(portalCashflowSource).not.toContain('시트 값 반영하기');
    expect(portalCashflowSource).not.toContain('시트와 연동하기');
    expect(portalCashflowSource).not.toContain('shouldShowCashflowSheetLab');
    expect(portalCashflowSource).not.toContain('deployment-surface');
    expect(portalCashflowSource).not.toMatch(/show[A-Za-z0-9]*Sheet[A-Za-z0-9]*Lab\s*&&/);
    expect(pageSource).toContain('usePortalStore');
    expect(pageSource).toContain('../../data/portal-store');
  });

  it('uses the lab BFF client without exposing legacy cashflow write actions', () => {
    expect(pageSource).toContain('previewCashflowSheetLabViaBff');
    expect(pageSource).toContain('saveCashflowSheetLabConfigViaBff');
    expect(pageSource).toContain('stageCashflowSheetLabViaBff');
    expect(pageSource).toContain('applyCashflowSheetLabViaBff');
    expect(pageSource).toContain('getCashflowSheetLabShareAccountViaBff');
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
    expect(pageSource).toContain('handleStageSheetValues');
    expect(pageSource).toContain('handleReflectSheetValues');
    expect(pageSource).toContain('handleSaveSheetConfig');
    expect(pageSource).toContain('handleLoadShareAccount');
    expect(pageSource).toContain('canPreview');
    expect(pageSource).toContain('stageResult');
    expect(pageSource).toContain('reflectResult');
    expect(pageSource).toContain('buildSourceKey');
    expect(pageSource).toContain('reviewedSourceKey === sourceKey');
    expect(pageSource).toContain('setReviewedSourceKey(sourceKey)');
    expect(pageSource).toContain('CashflowSheetHeroAnimation');
    expect(pageSource).toContain('cashflow-tile-float');
    expect(pageSource).not.toContain('motion/react');
    expect(pageSource).toContain('사업비 관리시트 연동');
    expect(pageSource).not.toContain('연동·동기화');
    expect(pageSource).not.toContain('1분만에 사업비 관리시트를 MYSCube에 연동하기');
    expect(pageSource).toContain('현재 연동된 시트 이름');
    expect(pageSource).toContain('linkedSpreadsheetTitle');
    expect(pageSource).toContain('파일 이름 확인 전');
    expect(pageSource).not.toContain('savedConfig?.spreadsheetId || savedConfig?.value');
    expect(pageSource).toContain('아래 공유계정 확인을 누르고 공유계정 복사를 눌러서 시트에 엑세스 권한을 업데이트 해요');
    expect(pageSource).toContain('공유 계정 확인');
    expect(pageSource).toContain('공유 계정 복사');
    expect(pageSource).toContain('연결된 시트');
    expect(pageSource).toContain('showSetupSteps');
    expect(pageSource).not.toContain('이미 연결된 시트 설정이 있습니다.');
    expect(pageSource).not.toContain('기존 설정으로 다시 검토하거나, 값을 바꾼 뒤 변경값 비교표를 만들 수 있습니다.');
    expect(pageSource).not.toContain('이미 연결된 시트 설정을 불러왔습니다.');
    expect(pageSource).not.toContain('shareConfirmed');
    expect(pageSource).not.toContain('공유 완료 확인하기');
    expect(pageSource).not.toContain('공유 완료 확인됨');
    expect(pageSource).toContain('Google Sheet를 위 공유 계정에 보기 권한으로 공유한 뒤 바로 검토하세요.');
    expect(pageSource).not.toContain('type="checkbox"');
    expect(pageSource).toContain('캐시플로우로 이동');
    expect(pageSource).toContain('value: sheetLink');
    expect(pageSource).not.toContain('변경값 비교표 만들기');
    expect(pageSource).toContain('시트 링크와 탭이름을 입력해주세요. 탭 이름과 시작 및 종료 주차는 사업에 맞게 조정해주세요');
    expect(pageSource).toContain('임시 저장');
    expect(pageSource).toContain('캐시플로우 값은 바뀌지 않습니다.');
    expect(pageSource).toContain('시트에서 플랫폼에 저장할 값을 검토해주세요.');
    expect(pageSource).toContain('MYSCube에 값 저장');
    expect(pageSource).toContain('전체 MYSCube에 저장하기');
    expect(pageSource).toContain('전체 MYSCube에 저장할까요?');
    expect(pageSource).toContain('applyDialogOpen');
    expect(pageSource).toContain('아래 주차별 차이를 확인한 뒤 저장합니다.');
    expect(pageSource).toContain('Actual은 기존 값이 있어도 시트 값을 기준으로 덮어씁니다.');
    expect(pageSource).toContain('stageCandidates');
    expect(pageSource).toContain('readyCtaClass');
    expect(pageSource).toContain('cashflow-ready-bob');
    expect(pageSource).toContain('MYSCube값');
    expect(pageSource).toContain('시트 값');
    expect(pageSource).toContain('저장 여부');
    expect(pageSource).toContain('저장 대상');
    expect(pageSource).toContain('저장 완료');
    expect(pageSource).toContain('시트 검토 완료');
    expect(pageSource).toContain('검토 범위');
    expect(pageSource).not.toContain('입금 합계');
    expect(pageSource).not.toContain('출금 합계');
    expect(pageSource).not.toContain('잔액');
    expect(pageSource).not.toContain('합계 기준');
    expect(pageSource).not.toContain('getCashflowSheetLabConfigViaBff');
    expect(pageSource).not.toContain('previewCashflowProjectionWritebackViaBff');
    expect(pageSource).not.toContain('applyCashflowProjectionWritebackViaBff');
    expect(pageSource).toContain('systemAccountEmail');
    expect(pageSource).not.toContain('mysc:cashflow-sheet-lab-action');
    expect(pageSource).not.toContain("action === 'apply'");
    expect(pageSource).not.toContain('config.load');
    expect(pageSource).not.toContain('toolbar.action');
    expect(pageSource).not.toContain('config.editor');
    expect(pageSource).not.toContain('writeback');
    expect(pageSource).not.toContain('!hideConfigChrome || editingConfig || config || errorMessage');
    expect(pageSource).not.toContain('onHeaderSummaryChange');
    expect(pageSource).not.toContain('시트 업데이트');
    expect(pageSource).not.toContain('시트와 연동할까요?');
    expect(pageSource).not.toContain('주차별 원본');
    expect(pageSource).not.toContain('원본 접기');
    expect(pageSource).not.toContain('캐시플로우 반영 미리보기');
    expect(pageSource).not.toContain('nonEmptyCellCount');
    expect(pageSource).not.toContain('Spreadsheet ID');
    expect(pageSource).not.toContain('Google 토큰');
    expect(pageSource).not.toContain("action === 'connect'");
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

  it('recovers BFF auth failures with a popup retry instead of redirecting', () => {
    expect(pageSource).toContain('requestBffActorAfterAuth');
    expect(pageSource).toContain('bffAuth.popup.required');
    expect(pageSource).toContain('bffAuth.rejected');
    expect(pageSource).toContain('firebaseToken || actor.idToken');
    expect(pageSource).toContain('getIdToken(Boolean(options.forceRefresh))');
    expect(pageSource).not.toContain('actor.idToken || firebaseToken');
    expect(pageSource).not.toContain("navigate('/login'");
  });
});
