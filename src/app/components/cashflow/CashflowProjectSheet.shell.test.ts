import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowProjectSheetSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowProjectSheet.tsx'),
  'utf8',
);
const cashflowWeeksStoreSource = readFileSync(
  resolve(import.meta.dirname, '../../data/cashflow-weeks-store.tsx'),
  'utf8',
);

describe('CashflowProjectSheet actual sync flow', () => {
  it('exposes the rescue operations dashboard from the project sheet shell', () => {
    expect(cashflowProjectSheetSource).toContain('renderOperationsPanel');
    expect(cashflowProjectSheetSource).toContain('운영 대시보드');
    expect(cashflowProjectSheetSource).toContain('opsSummary');
    expect(cashflowProjectSheetSource).toContain('확인 항목 ${opsSummary.inbox.length}건');
    expect(cashflowProjectSheetSource).toContain("item.id === 'projection-actual-diff'");
    expect(cashflowProjectSheetSource).toContain('입니다. 확인해 주세요.');
    expect(cashflowProjectSheetSource).toContain('결산 전 확인');
    expect(cashflowProjectSheetSource).toContain('시트 연동');
    expect(cashflowProjectSheetSource).toContain('Google Sheet 연결 후 변경 후보를 검토할 수 있습니다.');
    expect(cashflowProjectSheetSource).toContain('시트 연동 설정');
    expect(cashflowProjectSheetSource).not.toContain('시트 연동 검토');
  });

  it('keeps actual audit and sync store helpers separate from manual actual completion', () => {
    expect(cashflowProjectSheetSource).toContain('prepareAuditedWeekAmounts');
    expect(cashflowWeeksStoreSource).toContain('syncProjectCashflowActualsViaBff');
    expect(cashflowWeeksStoreSource).toContain('applyWeekAmountsToLocalWeeks');
    expect(cashflowWeeksStoreSource).toContain('applyProjectActualSyncResultLocally');
    expect(cashflowWeeksStoreSource).not.toContain('console.groupCollapsed');
    expect(cashflowWeeksStoreSource).not.toContain('console.table');
    expect(cashflowWeeksStoreSource).not.toContain('nonZero');
    expect(cashflowProjectSheetSource).toContain('handleSubmitWeek');
    expect(cashflowProjectSheetSource).toContain('작성완료');
  });

  it('keeps visible input in a private draft until an explicit final action', () => {
    expect(cashflowProjectSheetSource).toContain('prepareAuditedWeekAmounts');
    expect(cashflowProjectSheetSource).toContain('persisted.hasValue');
    expect(cashflowProjectSheetSource).toContain('parseAmount(drafts[key])');
    expect(cashflowProjectSheetSource).toContain('void savePrivateCashflowDraft()');
    expect(cashflowProjectSheetSource).not.toContain('void persistWeekValues(input)');
    expect(cashflowProjectSheetSource).not.toContain('저장할 변경사항이 없습니다.');
  });

  it('saves the private draft and releases the lease before a blocked in-app exit', () => {
    expect(cashflowProjectSheetSource).toContain('임시저장 후 나가기');
    expect(cashflowProjectSheetSource).toContain('await savePrivateCashflowDraft();');
    expect(cashflowProjectSheetSource).toContain('await cashflowLease.release();');
    expect(cashflowProjectSheetSource).toContain('blocker.proceed?.();');
  });

  it('removes projection/actual copy buttons while keeping canonical week saves', () => {
    expect(cashflowProjectSheetSource).not.toContain('copyMonthValues');
    expect(cashflowProjectSheetSource).not.toContain('setCopyingMode(direction)');
    expect(cashflowProjectSheetSource).not.toContain('Projection → Actual');
    expect(cashflowProjectSheetSource).not.toContain('Actual → Projection');
    expect(cashflowProjectSheetSource).toContain('await upsertWeekAmounts({');
  });

  it('formats persisted input values for display without changing numeric save parsing', () => {
    expect(cashflowProjectSheetSource).toContain('formatAmountInput(String(persisted.amount))');
    expect(cashflowProjectSheetSource).toContain('parseAmount(drafts[key])');
  });

  it('treats a persisted zero amount as a written sheet value', () => {
    expect(cashflowProjectSheetSource).toContain('function hasWrittenSheetValues');
    expect(cashflowProjectSheetSource).toContain('Object.prototype.hasOwnProperty.call(values, lineId)');
    expect(cashflowProjectSheetSource).toContain('hasWrittenSheetValues(doc?.actual)');
    expect(cashflowProjectSheetSource).not.toContain('Object.values(actual).some((v) => Number(v) !== 0)');
    expect(cashflowProjectSheetSource).not.toContain('Object.values(doc?.actual || {}).some((value) => Number(value) !== 0)');
  });

  it('shows projection 작성 from projectionUpdated on the project sheet header', () => {
    expect(cashflowProjectSheetSource).toContain('projectionUpdated: Boolean(doc?.projectionUpdated)');
    expect(cashflowProjectSheetSource).toContain("tableMode === 'projection'");
    expect(cashflowProjectSheetSource).toContain('weekMeta[w.weekNo]?.projectionUpdated');
  });

  it('uses per-week projection completion instead of the retired month projection save button', () => {
    expect(cashflowProjectSheetSource).toContain('handleCompleteProjectionWeek');
    expect(cashflowProjectSheetSource).toContain("tableMode === 'projection' && canEdit");
    expect(cashflowProjectSheetSource).not.toContain("tableMode === 'projection' && !weekMeta[w.weekNo]?.projectionUpdated");
    expect(cashflowProjectSheetSource).toContain('markCompleted: true');
    expect(cashflowProjectSheetSource).toContain('finalize: true');
    expect(cashflowProjectSheetSource).toContain('주차 Projection을 작성완료 처리했습니다.');
    expect(cashflowProjectSheetSource).not.toContain('Projection 저장');
  });

  it('keeps the projection, actual, and compare route contract available for embedding', () => {
    expect(cashflowProjectSheetSource).toContain("initialViewMode?: 'projection' | 'actual' | 'compare'");
    expect(cashflowProjectSheetSource).toContain("function renderSheetTable(tableMode: 'projection' | 'actual'");
    expect(cashflowProjectSheetSource).toContain('renderUnifiedMonthlyBoard');
    expect(cashflowProjectSheetSource).toContain('renderProjectionActualDiffTable');
    expect(cashflowProjectSheetSource).toContain('/portal/cashflow/${encodeURIComponent(projectId)}/sheets-lab');
    expect(cashflowProjectSheetSource).not.toContain('/portal/cashflow/sheets-lab?projectId=');
  });

  it('separates explicit sheet refresh from pinned-revision review', () => {
    expect(cashflowProjectSheetSource).toContain('getCashflowSheetLabMirrorViaBff');
    expect(cashflowProjectSheetSource).toContain('refreshCashflowSheetLabMirrorViaBff');
    expect(cashflowProjectSheetSource).toContain('stageCashflowSheetLabViaBff');
    expect(cashflowProjectSheetSource).toContain('handleRefreshSheetMirror');
    expect(cashflowProjectSheetSource).toContain('expectedMirrorRevision: cashflowSheetMirror.sourceRevision');
    expect(cashflowProjectSheetSource).toContain('const refreshIdempotencyKey =');
    expect(cashflowProjectSheetSource).toContain('const stageIdempotencyKey =');
    expect(cashflowProjectSheetSource).toContain('const applyIdempotencyKey =');
    expect(cashflowProjectSheetSource.indexOf('const refreshIdempotencyKey =')).toBeLessThan(cashflowProjectSheetSource.indexOf('const refreshMirror ='));
    expect(cashflowProjectSheetSource.indexOf('const stageIdempotencyKey =')).toBeLessThan(cashflowProjectSheetSource.indexOf('const stageMirror ='));
    expect(cashflowProjectSheetSource.indexOf('const applyIdempotencyKey =')).toBeLessThan(cashflowProjectSheetSource.indexOf('const apply = async'));
    expect(cashflowProjectSheetSource).toContain('시트 연동하기');
    expect(cashflowProjectSheetSource).toContain('최신값 다시 가져오기');
    expect(cashflowProjectSheetSource).toContain('FRESH');
    expect(cashflowProjectSheetSource).toContain('STALE');
    expect(cashflowProjectSheetSource).toContain('ERROR');
    expect(cashflowProjectSheetSource).toContain('capturedAt');
    expect(cashflowProjectSheetSource).toContain('비교 결과');
    expect(cashflowProjectSheetSource).toContain('sheetStageDialog');
    expect(cashflowProjectSheetSource).toContain('원장은 아직 변경되지 않았습니다.');
    expect(cashflowProjectSheetSource).toContain('기존 Actual 변경');
    expect(cashflowProjectSheetSource).toContain('lastAppliedBy');
    expect(cashflowProjectSheetSource).toContain('시트 업데이트 반영');
    expect(cashflowProjectSheetSource).toContain('시트 값 비교');
    expect(cashflowProjectSheetSource).toContain('renderSheetStageReviewGrid');
    expect(cashflowProjectSheetSource).toContain('renderSheetStageCandidateCell');
    expect(cashflowProjectSheetSource).toContain('검토한 값');
    expect(cashflowProjectSheetSource).toContain('시트에서 가져오기');
    expect(cashflowProjectSheetSource).toContain('시트로 내보내기');
    expect(cashflowProjectSheetSource).toContain('고정값 비교하기');
    expect(cashflowProjectSheetSource).toContain('시트에 쓸 값 미리보기');
    expect(cashflowProjectSheetSource).toContain('Actual은 이 방향에서 수정하지 않습니다.');
    expect(cashflowProjectSheetSource).toContain('direction=platform-to-sheet');
    expect(cashflowProjectSheetSource.indexOf('const sheetRangeLabel =')).toBeLessThan(cashflowProjectSheetSource.indexOf('function renderOperationsPanel'));
    expect(cashflowProjectSheetSource.indexOf('const sheetIdentityLabel =')).toBeLessThan(cashflowProjectSheetSource.indexOf('function renderOperationsPanel'));
    expect(cashflowProjectSheetSource).not.toContain('시트에서 플랫폼으로');
    expect(cashflowProjectSheetSource).not.toContain('플랫폼에서 시트로');
    expect(cashflowProjectSheetSource).not.toContain('플랫폼 값을 시트로 내보내기');
    expect(cashflowProjectSheetSource).not.toContain('0원 포함');
    expect(cashflowProjectSheetSource).not.toContain('setInterval');
  });

  it('shows cashflow event load failures instead of silently rendering an empty history', () => {
    expect(cashflowProjectSheetSource).toContain('cashflowEventsError');
    expect(cashflowProjectSheetSource).toContain('readCashflowEventsSnapshot');
    expect(cashflowProjectSheetSource).toContain('변경 이력을 불러오지 못했습니다.');
    expect(cashflowProjectSheetSource).toContain('아직 표시할 변경 기록이 없습니다.');
  });

  it('hydrates visible sheet weeks with canonical week dates before rendering labels', () => {
    expect(cashflowProjectSheetSource).toContain('function hydrateWeekDates');
    expect(cashflowProjectSheetSource).toContain('getMonthMondayWeeks(week.yearMonth)');
    expect(cashflowProjectSheetSource).toContain('hydrateWeekDates(week)');
  });

  it('loads cashflow weeks directly from Firestore year range without project assignment gating', () => {
    expect(cashflowWeeksStoreSource).toContain("where('yearMonth', '>=', carryForwardYearStart)");
    expect(cashflowWeeksStoreSource).toContain("where('yearMonth', '<=', selectedYearEnd)");
    expect(cashflowWeeksStoreSource).not.toContain("where('projectId'");
    expect(cashflowWeeksStoreSource).not.toContain('allowPrivilegedReadAll');
    expect(cashflowWeeksStoreSource).not.toContain('projectIds.length === 0');
  });

  it('prefers a freshly resolved Firebase ID token for BFF calls', () => {
    expect(cashflowProjectSheetSource).toContain('firebaseToken || currentActor.idToken');
    expect(cashflowProjectSheetSource).toContain('getIdToken(Boolean(options.forceRefresh))');
    expect(cashflowProjectSheetSource).toContain('latestBffActorRef.current = bffActor');
    expect(cashflowProjectSheetSource).not.toContain('if (firebaseToken || options.forceRefresh)');
    expect(cashflowProjectSheetSource).not.toContain('bffActor.idToken || firebaseToken');
    expect(cashflowProjectSheetSource).not.toContain('console.info');
    expect(cashflowProjectSheetSource).not.toContain('console.warn');
  });

  it('loads labor risk checks on page entry without a separate manual button', () => {
    expect(cashflowProjectSheetSource).toContain('handleRefreshLaborRisk');
    expect(cashflowProjectSheetSource).toContain('void handleRefreshLaborRisk();');
    expect(cashflowProjectSheetSource).toContain('페이지 새로고침 시 자동 계산');
    expect(cashflowProjectSheetSource).toContain('RefreshCw');
    expect(cashflowProjectSheetSource).toContain('fetchCashflowLaborRiskViaBff({');
    expect(cashflowProjectSheetSource).toContain('resolveBffActor({ forceRefresh: true })');
    expect(cashflowProjectSheetSource).not.toContain('onClick={() => void handleRefreshLaborRisk()}');
    expect(cashflowProjectSheetSource).not.toContain('수동 체크');
    expect(cashflowProjectSheetSource).not.toContain('handleManualLaborRiskCheck');
    expect(cashflowProjectSheetSource).not.toContain('laborRiskRequestKeyRef');
    expect(cashflowProjectSheetSource).not.toContain('requesting labor risk');
  });

  it('does not start cashflow realtime streams from the project sheet shell', () => {
    expect(cashflowProjectSheetSource).toContain('getDocs(q)');
    expect(cashflowProjectSheetSource).not.toContain('onSnapshot');
    expect(cashflowProjectSheetSource).not.toContain('setInterval');
    expect(cashflowProjectSheetSource).not.toContain('cashflowPresence');
    expect(cashflowProjectSheetSource).not.toContain('cashflowWeeksStreamKey');
    expect(cashflowProjectSheetSource).not.toContain('mysc:cashflow-projection-saved');
  });

  it('uses the shared 30-minute BFF lease and removes the legacy two-minute Firestore lock', () => {
    expect(cashflowProjectSheetSource).toContain('useCashflowEditLease');
    expect(cashflowProjectSheetSource).toContain('checkBeforeMutation');
    expect(cashflowProjectSheetSource).toContain('EditLeaseDialogs');
    expect(cashflowProjectSheetSource).toContain('30분 연장');
    expect(cashflowProjectSheetSource).toContain('임시저장');
    expect(cashflowProjectSheetSource).toContain('최종저장');
    expect(cashflowProjectSheetSource).not.toContain('CASHFLOW_EDIT_LOCK_TTL_MS');
    expect(cashflowProjectSheetSource).not.toContain('cashflowEditLocks');
    expect(cashflowProjectSheetSource).not.toContain('acquireCashflowEditLock');
    expect(cashflowProjectSheetSource).not.toContain('releaseCashflowEditLock');
    expect(cashflowWeeksStoreSource).not.toContain("transport: 'firestore'");
  });

  it('keeps ordinary saves private and batches only explicit final save into one atomic JVM command', () => {
    const ordinarySave = cashflowProjectSheetSource.slice(
      cashflowProjectSheetSource.indexOf('const handleSaveWeekValues'),
      cashflowProjectSheetSource.indexOf('const handleSubmitWeek'),
    );
    expect(ordinarySave).toContain('savePrivateCashflowDraft()');
    expect(cashflowProjectSheetSource).toContain('board: { drafts, weekSaveState, yearMonth }');
    expect(ordinarySave).not.toContain('persistWeekValues(input)');
    expect(cashflowProjectSheetSource).toContain('saveCashflowProjectionBatchViaBff');
    expect(cashflowProjectSheetSource).toContain('finalize: true');
    expect(cashflowProjectSheetSource).toContain('임시저장');
    expect(cashflowProjectSheetSource).toContain('최종저장');
  });

  it('rehydrates the owner draft after same-tab refresh without overwriting on token refresh', () => {
    expect(cashflowProjectSheetSource).toContain('loadedPrivateDraftKeyRef');
    expect(cashflowProjectSheetSource).toContain('privateDraftLoadRef');
    expect(cashflowProjectSheetSource).toContain('cashflowLease.ownership');
    expect(cashflowProjectSheetSource).toContain('hydrateCashflowPrivateDraft');
  });
});
