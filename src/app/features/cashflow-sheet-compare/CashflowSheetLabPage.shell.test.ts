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
    expect(pageSource).not.toContain('getCashflowSheetLabMirrorViaBff');
    expect(pageSource).toContain('refreshCashflowSheetLabMirrorViaBff');
    expect(pageSource).not.toContain('previewCashflowSheetLabViaBff');
    expect(pageSource).toContain('saveCashflowSheetLabConfigViaBff');
    expect(pageSource).toContain('stageCashflowSheetLabViaBff');
    expect(pageSource).toContain('applyCashflowSheetLabViaBff');
    expect(pageSource).not.toContain('settledWeekChangeConfirmationId: pending.confirmationId');
    expect(pageSource).not.toContain('주간 정산 값과 다릅니다');
    expect(pageSource).toContain('cashflow_closed_month_reason_required');
    expect(pageSource).toContain('cashflow_formula_mismatch_confirmation_required');
    expect(pageSource).toContain('cashflowFormulaMismatchesFromError');
    expect(pageSource).toContain('handleOverwriteSheetValues(pending.closedMonthChangeReason, pending.stage, true)');
    expect(pageSource).toContain('stageRunId: staged.runId');
    expect(pageSource).toContain('closedMonthFormulaAccepted,');
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
    expect(pageSource).toContain('handleOverwriteSheetValues');
    expect(pageSource).toContain('handleSaveSheetConfig');
    expect(pageSource).toContain('handleLoadShareAccount');
    expect(pageSource).toContain('void handleLoadShareAccount();');
    expect(pageSource).toContain('canRefresh');
    expect(pageSource).toContain('canOverwrite');
    expect(pageSource).toContain('reflectResult');
    expect(pageSource).toContain('buildSourceKey');
    expect(pageSource).toContain('reviewedSourceKey === sourceKey');
    expect(pageSource).toContain('buildSourceKey({ projectId, sourceYear, value: sheetLink, sheetName: nextSheetName, startWeek, endWeek })');
    expect(pageSource).toContain('expectedMirrorRevision,');
    expect(pageSource).toContain('const refreshIdempotencyKey =');
    expect(pageSource).toContain('const stageIdempotencyKey =');
    expect(pageSource).toContain('const applyIdempotencyKey =');
    expect(pageSource.indexOf('const refreshIdempotencyKey =')).toBeLessThan(pageSource.indexOf("runWithBffAuthRetry('mirror.refresh'"));
    expect(pageSource.indexOf('const stageIdempotencyKey =')).toBeLessThan(pageSource.indexOf("runWithBffAuthRetry('stage.sheet_values'"));
    expect(pageSource.indexOf('const applyIdempotencyKey =')).toBeLessThan(pageSource.indexOf("runWithBffAuthRetry('apply.sheet_values'"));
    expect(pageSource).toContain('CashflowSheetHeroAnimation');
    expect(pageSource).toContain('CashflowSheetSyncOverlay');
    expect(pageSource).toContain('inert={loading || undefined}');
    expect(pageSource).toContain('operation={loadingOperation}');
    expect(pageSource).toContain('cashflow-tile-float');
    expect(pageSource).not.toContain('motion/react');
    expect(pageSource).toContain('사업비 관리시트 연동');
    expect(pageSource).not.toContain('연동·동기화');
    expect(pageSource).not.toContain('1분만에 사업비 관리시트를 MYSCube에 연동하기');
    expect(pageSource).not.toContain('현재 연동된 시트 이름');
    expect(pageSource).not.toContain('linkedSpreadsheetTitle');
    expect(pageSource).not.toContain('파일 이름 확인 전');
    expect(pageSource).not.toContain('savedConfig?.spreadsheetId || savedConfig?.value');
    expect(pageSource).toContain('서비스 계정을 Google Sheet 편집자로 공유');
    expect(pageSource).toContain('다시 불러오기');
    expect(pageSource).toContain('공유 계정 복사');
    expect(pageSource).toContain('void handleLoadShareAccount({ forceHydrate: true });');
    expect(pageSource).toContain('서비스 계정 이메일을 확인하지 못했습니다. 다시 불러오기를 눌러 주세요.');
    expect(pageSource).not.toContain('공유 계정 확인을 다시 눌러 주세요.');
    expect(pageSource).toContain('Google Sheet 공유 창에서 위 계정을 추가하고 권한을 <strong>편집자</strong>');
    expect(pageSource).not.toContain('연결된 시트');
    expect(pageSource).not.toContain('showSetupSteps');
    expect(pageSource).not.toContain('이미 연결된 시트 설정이 있습니다.');
    expect(pageSource).not.toContain('기존 설정으로 다시 검토하거나, 값을 바꾼 뒤 변경값 비교표를 만들 수 있습니다.');
    expect(pageSource).not.toContain('이미 연결된 시트 설정을 불러왔습니다.');
    expect(pageSource).not.toContain('shareConfirmed');
    expect(pageSource).not.toContain('공유 완료 확인하기');
    expect(pageSource).not.toContain('공유 완료 확인됨');
    expect(pageSource).not.toContain('Google Sheet를 위 공유 계정에 보기 권한으로 공유한 뒤 바로 검토하세요.');
    expect(pageSource).not.toContain('type="checkbox"');
    expect(pageSource).toContain('캐시플로우로 이동');
    expect(pageSource).toContain('value: sheetLink');
    expect(pageSource).not.toContain('변경값 비교표 만들기');
    expect(pageSource).toContain('시트 연결');
    expect(pageSource).toContain('시트 정보 저장');
    expect(pageSource).toContain('forceHydrate || !hasSheetDraft || scopedConfig.sourceYear !== savedConfig?.sourceYear');
    expect(pageSource).toContain('generation !== configLoadGenerationRef.current');
    expect(pageSource).toContain('연동 연도');
    expect(pageSource).not.toContain('캐시플로우 값은 바뀌지 않습니다.');
    expect(pageSource).toContain('시트 값 가져오기');
    expect(pageSource).toContain('시트 값 다시 가져오기');
    expect(pageSource).toContain("mirror?.lastRefreshError?.message");
    expect(pageSource).toContain('mirror.lastRefreshError.diagnostics');
    expect(pageSource).toContain('diagnostic.sourceCell');
    expect(pageSource).toContain('시트 연동 오류');
    expect(pageSource).not.toContain('시트 고정본 ·');
    expect(pageSource).not.toContain('검토 범위');
    expect(pageSource).toContain('시트 값으로 덮어쓰기');
    expect(pageSource).toContain('!open && !applyResumeRequired');
    expect(pageSource).toContain('!applyResumeRequired && (');
    expect(pageSource).not.toContain('변경 내용 검토');
    expect(pageSource).not.toContain('전체 MYSCube에 저장할까요?');
    expect(pageSource).not.toContain('applyDialogOpen');
    expect(pageSource).toContain('별도 운영자 검토는 없으며');
    expect(pageSource).toContain("staged.status === 'BLOCKED'");
    expect(pageSource).toContain('staged?.closedMonthDifferences');
    expect(pageSource).toContain('결산 후 값이 달라요');
    expect(pageSource).toContain('closedMonthManifestComplete');
    expect(pageSource).toContain('closedMonthDifferenceManifestHash');
    expect(pageSource).toContain('closedMonthDifferenceCount');
    expect(pageSource).toContain('캐시플로우로 이동');
    expect(pageSource).toContain('max-w-[760px]');
    expect(pageSource).toContain('aria-label="결산 후 변경 후보 전체 목록"');
    expect(pageSource).not.toContain('stageCandidates');
    expect(pageSource).not.toContain('readyCtaClass');
    expect(pageSource).not.toContain('primaryCta');
    expect(pageSource).toContain('MYSCube를 덮어썼습니다.');
    expect(pageSource).toContain('덮어쓰기 완료');
    expect(pageSource).not.toContain('시트 고정본 ·');
    expect(pageSource).not.toContain('검토 범위');
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

  it('does not hold a project edit lease while configuring, reviewing, or applying a sheet', () => {
    expect(pageSource).not.toContain('useCashflowEditLease');
    expect(pageSource).not.toContain('checkBeforeMutation');
    expect(pageSource).not.toContain('EditLeaseDialogs');
    expect(pageSource).not.toContain('수정 시작');
    expect(pageSource).not.toContain('lease: mutationLease');
    expect(pageSource).not.toContain('cashflowEditLocks');
  });

  it('saves the shared sheet configuration through the BFF without a private edit draft', () => {
    expect(pageSource).toContain('saveCashflowSheetLabConfigViaBff');
    expect(pageSource).toContain('settings.save.ok');
    expect(pageSource).not.toContain('createCashflowPrivateDraftClient');
    expect(pageSource).not.toContain('cashflowPrivateDraftClient');
    expect(pageSource).not.toContain('finalize: true');
  });

  it('records conservative end-to-end and step timings for manual Stage QA', () => {
    expect(pageSource).toContain("logCashflowLab('overwrite.sheet_values.start'");
    expect(pageSource).toContain('stageDurationMs');
    expect(pageSource).toContain('applyDurationMs');
    expect(pageSource).toContain('totalDurationMs');
    expect(pageSource).toContain("logCashflowLab('overwrite.sheet_values.ok'");
    expect(pageSource).toContain("logCashflowLab('overwrite.sheet_values.error'");
  });

  it('shows exact closed-month changes and waits for explicit reason confirmation before apply', () => {
    const stagedFlow = pageSource.slice(
      pageSource.indexOf("if (staged.stagedLineCount === 0)"),
      pageSource.indexOf("activeStep = 'apply'"),
    );
    expect(stagedFlow).toContain('staged.closedMonthDifferences?.length');
    expect(stagedFlow).toContain('setClosedMonthStage(staged)');
    expect(pageSource).toContain("change.mode === 'projection' ? 'Projection' : 'Actual'");
    expect(pageSource).toContain('CASHFLOW_SHEET_LINE_LABELS[change.lineId as CashflowSheetLineId] || change.lineId');
    expect(pageSource).toContain('change.beforeHadValue');
    expect(pageSource).toContain('change.afterHadValue');
    expect(pageSource).toContain('변경 이력과 경고 횟수에 함께 기록됩니다. 그래도 반영할까요?');
    expect(pageSource).toContain('!closedMonthChangeReason.trim()');
    expect(pageSource).toContain('closedMonthStage,');
  });

  it('guides each project through the sheet workflow once per browser session', () => {
    expect(pageSource).toContain('cashflow-sheet-tutorial:');
    expect(pageSource).toContain('sessionStorage.getItem');
    expect(pageSource).toContain('sessionStorage.setItem');
    expect(pageSource).toContain('시트 연동 가이드');
    expect(pageSource).toContain('detectedYearModes');
    expect(pageSource).toContain('연간 합계는 임의의 주차로 나누지 않고');
    expect(pageSource).toContain('시트에 없는 연도는 오류로 처리하지 않습니다.');
    expect(pageSource).toContain('scrollIntoView');
    expect(pageSource).toContain('aria-modal="true"');
  });
});
