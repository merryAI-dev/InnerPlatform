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
  });

  it('keeps actual audit and sync store helpers separate from manual actual completion', () => {
    expect(cashflowProjectSheetSource).toContain('prepareAuditedWeekAmounts');
    expect(cashflowWeeksStoreSource).toContain('syncProjectCashflowActualsViaBff');
    expect(cashflowWeeksStoreSource).toContain('applyWeekAmountsToLocalWeeks');
    expect(cashflowWeeksStoreSource).toContain('applyProjectActualSyncResultLocally');
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
    expect(cashflowProjectSheetSource).toContain('if (options.forceRefresh)');
    expect(cashflowProjectSheetSource).not.toContain('if (firebaseToken || options.forceRefresh)');
    expect(cashflowProjectSheetSource).not.toContain('bffActor.idToken || firebaseToken');
  });

  it('keeps labor risk as an explicit manual action only', () => {
    expect(cashflowProjectSheetSource).toContain('const handleManualLaborRiskCheck = useCallback(async () => {');
    expect(cashflowProjectSheetSource).toContain('fetchCashflowLaborRiskViaBff({');
    expect(cashflowProjectSheetSource).not.toContain('laborRiskRequestKeyRef');
    expect(cashflowProjectSheetSource).not.toContain('requesting labor risk');
    expect(cashflowProjectSheetSource).not.toContain('background labor risk');
  });

  it('does not stream or broadcast cashflow sheet state from the project sheet', () => {
    expect(cashflowProjectSheetSource).not.toContain('onSnapshot');
    expect(cashflowProjectSheetSource).not.toContain('setInterval');
    expect(cashflowProjectSheetSource).not.toContain('cashflowPresence');
    expect(cashflowProjectSheetSource).not.toContain("dispatchEvent(new CustomEvent('mysc:cashflow-projection-saved'");
  });
});
