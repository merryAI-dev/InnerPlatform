import { describe, expect, it } from 'vitest';
import { buildSheetApplyNotice, describeSheetApplyChange } from './cashflow-sheet-apply-notice';
import type { CashflowSheetLabChangeCandidate } from '../../lib/sheets-cashflow-readonly-client';

const base: CashflowSheetLabChangeCandidate = {
  projectId: 'p1', runId: 'r1', source: 'google_sheet', status: 'pending_review',
  mode: 'projection', yearMonth: '2026-04', weekNo: 5, lineId: 'SALES_IN', lineDirection: 'in',
  beforeAmount: 100, beforeHadValue: true, proposedAmount: null, proposedHadValue: false,
  createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('sheet apply notice', () => {
  it('counts the changed cells, not the rewritten month (160 per month)', () => {
    // 라이브 2026-08-19: 변경 2건인데 "160건 반영" 이 떴다. 160 은 다시 쓴 월의 전체 셀 수다.
    const notice = buildSheetApplyNotice({
      stagedLineCount: 2,
      candidates: [
        base,
        { ...base, lineId: 'SALES_VAT_IN', beforeAmount: 10, proposedAmount: null },
      ],
    });
    expect(notice.title).toBe('시트값 2건을 MYSCube에 반영했어요.');
    expect(notice.lines).toEqual([
      '26-4-5 Projection 매출액(입금) 100원 → 빈칸',
      '26-4-5 Projection 매출부가세(입금) 10원 → 빈칸',
    ]);
  });

  it('says what changed, before and after', () => {
    expect(describeSheetApplyChange({
      ...base, mode: 'actual', yearMonth: '2026-08', weekNo: 2, lineId: 'DIRECT_COST_OUT',
      beforeAmount: null, beforeHadValue: false, proposedAmount: 2416709, proposedHadValue: true,
    })).toBe('26-8-2 Actual 직접사업비 빈칸 → 2,416,709원');
    expect(describeSheetApplyChange({
      ...base, scope: 'annual', year: 2025, yearMonth: undefined, weekNo: undefined,
      beforeAmount: 0, beforeHadValue: true, proposedAmount: 500000, proposedHadValue: true,
    })).toBe('2025년 연간 Projection 매출액(입금) 0원 → 500,000원');
  });

  it('shows three lines and folds the rest into a count', () => {
    const notice = buildSheetApplyNotice({
      stagedLineCount: 7,
      candidates: Array.from({ length: 7 }, (_, i) => ({ ...base, weekNo: (i % 5) + 1 })),
    });
    expect(notice.lines).toHaveLength(4);
    expect(notice.lines.at(-1)).toBe('외 4건');
  });

  it('trusts stagedLineCount when the candidate list was truncated or missing', () => {
    expect(buildSheetApplyNotice({ stagedLineCount: 612, candidates: [base] }).title)
      .toBe('시트값 612건을 MYSCube에 반영했어요.');
    expect(buildSheetApplyNotice({ stagedLineCount: 612, candidates: [base] }).lines.at(-1)).toBe('외 611건');
    expect(buildSheetApplyNotice({ stagedLineCount: 3, candidates: null }))
      .toEqual({ title: '시트값 3건을 MYSCube에 반영했어요.', lines: [] });
  });

  it('does not invent changes when nothing changed', () => {
    expect(buildSheetApplyNotice({ stagedLineCount: 0, candidates: [] }))
      .toEqual({ title: '시트값을 반영했어요. 바뀐 값은 없어요.', lines: [] });
  });
});
