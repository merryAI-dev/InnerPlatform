import { describe, expect, it } from 'vitest';
import { mergeCashflowProjectionActualSummaryBatch } from './useCashflowProjectionActualSummaries';

const summary = (projectId: string, amount = 18_371_453) => ({
  projectId,
  fromMonth: '2023-01',
  comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
  projectionAmount: amount,
  actualAmount: 0,
  projectionActualDifferenceAmount: amount,
  settlementDifferenceAmount: amount,
  settlementMatches: amount === 0,
  periods: [],
});

describe('mergeCashflowProjectionActualSummaryBatch', () => {
  it('keeps nine successes and marks only the explicit tenth failure', () => {
    const ids = Array.from({ length: 10 }, (_, index) => `p${index + 1}`);
    const result = mergeCashflowProjectionActualSummaryBatch(
      { summaries: {}, errors: {} },
      ids,
      { version: '1', items: ids.slice(0, 9).map((id) => summary(id)), errors: [{ projectId: 'p10', code: 'SUMMARY_UNAVAILABLE' }] },
    );
    expect(Object.keys(result.summaries)).toHaveLength(9);
    expect(result.errors).toMatchObject({ p1: false, p9: false, p10: true });
  });

  it('retains a prior success when its retry fails', () => {
    const retained = summary('p1');
    const result = mergeCashflowProjectionActualSummaryBatch(
      { summaries: { p1: retained }, errors: { p1: false } },
      ['p1'],
      { version: '1', items: [], errors: [{ projectId: 'p1', code: 'SUMMARY_UNAVAILABLE' }] },
    );
    expect(result.summaries.p1).toBe(retained);
    expect(result.errors.p1).toBe(true);
  });

  it('marks an omitted requested ID as failed without clearing other data', () => {
    const retained = summary('p0');
    const result = mergeCashflowProjectionActualSummaryBatch(
      { summaries: { p0: retained }, errors: {} },
      ['p1', 'p2'],
      { version: '1', items: [summary('p1')], errors: [] },
    );
    expect(result.summaries).toMatchObject({ p0: retained, p1: summary('p1') });
    expect(result.errors).toMatchObject({ p1: false, p2: true });
  });
});
