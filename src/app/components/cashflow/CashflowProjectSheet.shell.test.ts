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
  it('keeps actual sync separate from manual actual save', () => {
    expect(cashflowProjectSheetSource).toContain('Actual 동기화');
    expect(cashflowProjectSheetSource).toContain('syncProjectActualsFromExpenseSheets');
    expect(cashflowWeeksStoreSource).toContain('syncProjectCashflowActualsViaBff');
    expect(cashflowWeeksStoreSource).toContain('applyWeekAmountsToLocalWeeks');
    expect(cashflowProjectSheetSource).toContain('Actual 저장');
  });

  it('saves visible month values instead of draft-only input changes', () => {
    expect(cashflowProjectSheetSource).toContain('persistWeekValues');
    expect(cashflowProjectSheetSource).toContain('persisted.hasValue');
    expect(cashflowProjectSheetSource).toContain('parseAmount(drafts[cellKey])');
    expect(cashflowProjectSheetSource).toContain('await persistWeekValues({ weekNo, mode: targetMode })');
    expect(cashflowProjectSheetSource).not.toContain('저장할 변경사항이 없습니다.');
  });

  it('persists projection/actual copy through the canonical week upsert path', () => {
    expect(cashflowProjectSheetSource).toContain('copyMonthValues');
    expect(cashflowProjectSheetSource).toContain('setCopyingMode(direction)');
    expect(cashflowProjectSheetSource).toContain('await upsertWeekAmounts({');
    expect(cashflowProjectSheetSource).toContain('서버에 복사했습니다');
    expect(cashflowProjectSheetSource).not.toContain('초안으로 복사했습니다');
  });
});
