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
    expect(cashflowProjectSheetSource).toContain('시트 값 가져오기 연결됨');
    expect(cashflowProjectSheetSource).toContain('시트 값 가져오기 미연결');
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

  it('saves visible month values instead of draft-only input changes', () => {
    expect(cashflowProjectSheetSource).toContain('persistWeekValues');
    expect(cashflowProjectSheetSource).toContain('persisted.hasValue');
    expect(cashflowProjectSheetSource).toContain('parseAmount(drafts[key])');
    expect(cashflowProjectSheetSource).toContain('void persistWeekValues(input)');
    expect(cashflowProjectSheetSource).not.toContain('저장할 변경사항이 없습니다.');
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
    expect(cashflowProjectSheetSource).toContain('projectionUpdated: true');
    expect(cashflowProjectSheetSource).toContain('주차 Projection을 작성완료 처리했습니다.');
    expect(cashflowProjectSheetSource).not.toContain('Projection 저장');
  });

  it('keeps the projection, actual, and compare route contract available for embedding', () => {
    expect(cashflowProjectSheetSource).toContain("initialViewMode?: 'projection' | 'actual' | 'compare'");
    expect(cashflowProjectSheetSource).toContain("function renderSheetTable(tableMode: 'projection' | 'actual'");
    expect(cashflowProjectSheetSource).toContain('renderUnifiedMonthlyBoard');
    expect(cashflowProjectSheetSource).toContain('renderProjectionActualDiffTable');
  });

  it('replaces the empty-row toggle with an explicit sheet refresh action', () => {
    expect(cashflowProjectSheetSource).toContain('applyCashflowSheetLabViaBff');
    expect(cashflowProjectSheetSource).toContain('handleRefreshSheetValues');
    expect(cashflowProjectSheetSource).toContain('시트 값을 새로고침했습니다.');
    expect(cashflowProjectSheetSource).toContain('시트 값 반영 완료');
    expect(cashflowProjectSheetSource).toContain('lastAppliedBy');
    expect(cashflowProjectSheetSource).toContain('새로고침');
    expect(cashflowProjectSheetSource).not.toContain('0원 포함');
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

  it('keeps labor risk checks behind an explicit refresh action', () => {
    expect(cashflowProjectSheetSource).toContain('handleRefreshLaborRisk');
    expect(cashflowProjectSheetSource).toContain('새로 고침');
    expect(cashflowProjectSheetSource).toContain('RefreshCw');
    expect(cashflowProjectSheetSource).toContain('fetchCashflowLaborRiskViaBff({');
    expect(cashflowProjectSheetSource).toContain('resolveBffActor({ forceRefresh: true })');
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
});
