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
  it('removes manual actual save and sync from the cashflow screen', () => {
    expect(cashflowProjectSheetSource).not.toContain('Actual 불러오기');
    expect(cashflowProjectSheetSource).not.toContain('Actual 저장');
    expect(cashflowProjectSheetSource).not.toContain('syncProjectActualsFromExpenseSheets');
    expect(cashflowWeeksStoreSource).not.toContain('syncProjectCashflowActualsViaBff');
    expect(cashflowWeeksStoreSource).toContain('upsertProjectionAmounts');
    expect(cashflowWeeksStoreSource).not.toContain('upsertWeekAmounts');
  });

  it('keeps actual read-only while projection saves use visible values', () => {
    expect(cashflowProjectSheetSource).toContain('persistProjectionWeekValues');
    expect(cashflowProjectSheetSource).toContain('flushProjectionWeek');
    expect(cashflowProjectSheetSource).toContain("if (tableMode === 'actual')");
    expect(cashflowProjectSheetSource).toContain('Actual은 저장된 기준값만 표시합니다.');
    expect(cashflowProjectSheetSource).toContain('persisted.hasValue');
    expect(cashflowProjectSheetSource).toContain('parseAmount(drafts[cellKey])');
    expect(cashflowProjectSheetSource).not.toContain('저장할 변경사항이 없습니다.');
  });

  it('removes projection/actual copy buttons while keeping canonical week saves', () => {
    expect(cashflowProjectSheetSource).not.toContain('copyMonthValues');
    expect(cashflowProjectSheetSource).not.toContain('setCopyingMode(direction)');
    expect(cashflowProjectSheetSource).not.toContain('Projection → Actual');
    expect(cashflowProjectSheetSource).not.toContain('Actual → Projection');
    expect(cashflowProjectSheetSource).toContain('await upsertProjectionAmounts({');
    expect(cashflowWeeksStoreSource).toContain('upsertWeeklyExpenseProjectionViaBff');
    expect(cashflowWeeksStoreSource).toContain('upsertProjectionAmounts');
    expect(cashflowWeeksStoreSource).not.toContain('upsertWeekAmounts');
    expect(cashflowWeeksStoreSource).not.toContain('/cashflow-weeks/upsert');
  });

  it('formats persisted input values for display without changing numeric save parsing', () => {
    expect(cashflowProjectSheetSource).toContain('formatAmountInput(String(persisted.amount))');
    expect(cashflowProjectSheetSource).toContain('parseAmount(drafts[cellKey])');
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
    expect(cashflowProjectSheetSource).not.toContain('projectionUpdated: true');
    expect(cashflowProjectSheetSource).not.toContain('onUpdateWeeklySubmissionStatus');
    expect(cashflowProjectSheetSource).toContain('주차 Projection을 작성완료 처리했습니다.');
    expect(cashflowProjectSheetSource).not.toContain('Projection 저장');
  });

  it('can initialize directly on the projection tab from routing', () => {
    expect(cashflowProjectSheetSource).toContain("initialViewMode = 'compare'");
    expect(cashflowProjectSheetSource).toContain("useState<'projection' | 'actual' | 'compare'>(initialViewMode)");
  });

  it('loads platform cashflow weeks through the Java read model instead of Firestore', () => {
    expect(cashflowProjectSheetSource).toContain('ensureProjectCashflowSnapshot(projectId)');
    expect(cashflowProjectSheetSource).toContain('getReadModelForProjectMonth(projectId, normalizedYearMonth)');
    expect(cashflowProjectSheetSource).not.toContain('computeCashflowDerivedTotals');
    expect(cashflowProjectSheetSource).not.toContain('computeOpeningCashflowTotals');
    expect(cashflowWeeksStoreSource).toContain('fetchWeeklyExpenseCashflowViaBff');
    expect(cashflowWeeksStoreSource).toContain('buildCashflowWeeksFromSnapshot');
    expect(cashflowWeeksStoreSource).toContain('buildCashflowReadModelsFromSnapshot');
    expect(cashflowWeeksStoreSource).toContain("if (isPlatformApiEnabled() && user.source !== 'dev_harness')");
    expect(cashflowWeeksStoreSource).toContain("where('yearMonth', '>=', carryForwardYearStart)");
    expect(cashflowWeeksStoreSource).toContain("where('yearMonth', '<=', selectedYearEnd)");
    expect(cashflowWeeksStoreSource).not.toContain("where('projectId'");
    expect(cashflowWeeksStoreSource).not.toContain('allowPrivilegedReadAll');
    expect(cashflowWeeksStoreSource).not.toContain('projectIds.length === 0');
  });

  it('does not read weekly submission status directly from Firestore before close', () => {
    expect(cashflowProjectSheetSource).not.toContain('getDoc(statusRef)');
    expect(cashflowProjectSheetSource).not.toContain("getOrgDocumentPath(orgId, 'weeklySubmissionStatus'");
    expect(cashflowProjectSheetSource).toContain('resolveWeeklyAccountingState(undefined, byWeekNo.get(weekNo))');
  });

  it('does not write cashflow status directly to Firestore in the store', () => {
    expect(cashflowWeeksStoreSource).toContain('submitWeeklyExpenseWeekViaBff');
    expect(cashflowWeeksStoreSource).toContain('closeWeeklyExpenseWeekViaBff');
    expect(cashflowWeeksStoreSource).not.toContain('updateDoc(');
    expect(cashflowWeeksStoreSource).not.toContain('setDoc(');
    expect(cashflowWeeksStoreSource).toContain('저장 경로를 확인할 수 없습니다.');
  });
});
