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
  it('does not expose manual actual sync/save actions on the cashflow screen', () => {
    expect(cashflowProjectSheetSource).not.toContain('Actual 불러오기');
    expect(cashflowProjectSheetSource).not.toContain('Actual 저장');
    expect(cashflowProjectSheetSource).not.toContain('syncProjectActualsFromExpenseSheets');
    expect(cashflowProjectSheetSource).not.toContain('actualSyncing');
    expect(cashflowProjectSheetSource).not.toContain('monthSavingMode');
    expect(cashflowWeeksStoreSource).not.toContain('syncProjectCashflowActualsViaBff');
    expect(cashflowWeeksStoreSource).not.toContain('upsertCashflowWeekAmountsViaBff');
    expect(cashflowWeeksStoreSource).toContain('fetchCashflowSnapshotViaPlatformApi');
  });

  it('saves visible weekly values instead of draft-only input changes', () => {
    expect(cashflowProjectSheetSource).toContain('persistWeekValues');
    expect(cashflowProjectSheetSource).toContain('persisted.hasValue');
    expect(cashflowProjectSheetSource).toContain('parseAmount(drafts[cellKey])');
    expect(cashflowProjectSheetSource).not.toContain('저장할 변경사항이 없습니다.');
  });

  it('removes projection/actual copy buttons while keeping canonical week saves', () => {
    expect(cashflowProjectSheetSource).not.toContain('copyMonthValues');
    expect(cashflowProjectSheetSource).not.toContain('setCopyingMode(direction)');
    expect(cashflowProjectSheetSource).not.toContain('Projection → Actual');
    expect(cashflowProjectSheetSource).not.toContain('Actual → Projection');
    expect(cashflowProjectSheetSource).toContain('await upsertWeekAmounts({');
    expect(cashflowProjectSheetSource).toContain("if (input.mode === 'actual') return;");
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
    expect(cashflowProjectSheetSource).toContain('projectionUpdated: true');
    expect(cashflowProjectSheetSource).toContain('주차 Projection을 작성완료 처리했습니다.');
    expect(cashflowProjectSheetSource).not.toContain('Projection 저장');
  });

  it('can initialize directly on the projection tab from routing', () => {
    expect(cashflowProjectSheetSource).toContain("initialViewMode = 'compare'");
    expect(cashflowProjectSheetSource).toContain("useState<'projection' | 'actual' | 'compare'>(initialViewMode)");
  });

  it('loads cashflow weeks directly from Firestore year range without project assignment gating', () => {
    expect(cashflowWeeksStoreSource).toContain('hydrateProjectCashflowSnapshot');
    expect(cashflowWeeksStoreSource).toContain('fetchCashflowSnapshotViaPlatformApi');
    expect(cashflowWeeksStoreSource).not.toContain("where('projectId'");
    expect(cashflowWeeksStoreSource).not.toContain('allowPrivilegedReadAll');
    expect(cashflowWeeksStoreSource).not.toContain('projectIds.length === 0');
  });

  it('keeps actual read-only and hydrates it from the Java read model', () => {
    expect(cashflowProjectSheetSource).toContain('hydrateProjectCashflowSnapshot({ projectId })');
    expect(cashflowProjectSheetSource).toContain("tableMode === 'actual' || !canEdit");
    expect(cashflowProjectSheetSource).not.toContain("mode: 'actual',\\n        amounts");
    expect(cashflowProjectSheetSource).not.toContain('실적값을 확인하고 필요 시 보정합니다.');
  });
});
